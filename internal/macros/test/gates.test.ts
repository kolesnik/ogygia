/**
 * `$dev()` and `$rules()`: a marked function's calls, here or in a module that imports it, go behind
 * its gate; a production build drops the function, a rules build keeps the rules tier, and every
 * shape the build cannot see through is refused.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown } from 'rolldown';
import { describe, expect, test } from 'vitest';
import { check } from 'ogygia-internal-compilerkit/testing';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import { compile } from '../src/compile.ts';
import { ogygia_macros } from '../src/plugin.ts';

const FIXTURES = fileURLToPath(new URL('./fixtures/gates/', import.meta.url));
const OPTIONS = { mode: 'dev', runtime: 'rt', reference: 'rt' } as const;

/** A module's text, one line each. */
const lines = (...rows: ReadonlyArray<string>): string => rows.map((r) => `${r}\n`).join('');

/** Compiles `files` (name → text) in a temporary folder; the output of `name`. */
function compiled(files: Record<string, string>, name: string): string | null {
	const dir = mkdtempSync(join(tmpdir(), 'og-gates-'));
	try {
		for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
		return compile(files[name]!, name, { ...OPTIONS, path: join(dir, name) })?.code ?? null;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const CHECKS = `${dedent`
	export function check(n: number): void {
		$dev();
		log(n);
	}
	export function note(n: number): void {
		$rules();
		log(n);
	}
`}\n`;

describe('the calls', () => {
	test('in the defining module: behind the gate, and the mark compiles away', () => {
		const out = compiled({ 'a.ts': `${CHECKS}${lines('check(1);', 'note(2);')}` }, 'a.ts')!;
		expect(out).toContain("import { DEV } from 'esm-env'");
		expect(out).toContain('const RULES = import.meta.env?.DEV ||');
		expect(out).toContain('DEV && check(1);');
		expect(out).toContain('RULES && note(2);');
		expect(out).not.toMatch(/\$dev|\$rules/);
	});

	test('in a module that imports the function, though it names no macro', () => {
		const out = compiled(
			{
				'a.ts': CHECKS,
				'b.ts': `${dedent`
					import { check, note } from './a.ts';
					export function go(n: number) {
						if (n) check(n);
						note(n);
					}
				`}\n`
			},
			'b.ts'
		)!;
		expect(out).toContain('if (n) DEV && check(n);');
		expect(out).toContain('RULES && note(n);');
	});

	test('a local of the same name is not the marked function', () => {
		const out = compiled(
			{
				'a.ts': `${CHECKS}${lines('function f(check: (n: number) => void) {', '\tcheck(1);', '}')}`
			},
			'a.ts'
		)!;
		expect(out).toContain('\tcheck(1);');
		expect(out).not.toContain('DEV && check(1)');
	});

	test('a module that neither marks nor imports a marked function is left as it is', () => {
		expect(compiled({ 'a.ts': 'export const a = 1;\n' }, 'a.ts')).toBeNull();
	});
});

describe('refused', () => {
	const refused = (files: Record<string, string>, name: string) =>
		check(() => compiled(files, name));

	test('a marked function handed on as a value, or its result read', () => {
		refused({ 'a.ts': `${CHECKS}run(check);\n` }, 'a.ts').fails(
			'a.ts:9:5  check runs behind the dev gate ($dev): call it, never hand it on as a value.'
		);
		refused({ 'a.ts': `${CHECKS}const r = note(1);\n` }, 'a.ts').fails(
			'note(…) runs behind the rules gate ($rules): its call is a statement'
		);
	});

	test('a mark anywhere but the first statement of a top-level function', () => {
		refused({ 'a.ts': lines('function f(): void {', '\tg();', '\t$dev();', '}') }, 'a.ts').fails(
			'a.ts:3:2  $dev() marks the function it is the first statement of'
		);
		refused({ 'a.ts': lines('export const f = () => {', '\t$rules();', '};') }, 'a.ts').fails(
			'$rules() marks the function it is the first statement of'
		);
		refused({ 'a.ts': lines('function f(): void {', '\t$dev(1);', '}') }, 'a.ts').fails(
			'$dev() takes nothing'
		);
		refused({ 'a.ts': lines('async function f() {', '\t$dev();', '}') }, 'a.ts').fails(
			'$dev() marks a plain function'
		);
	});

	test('a re-export, or a whole-module import, of a module with marked functions', () => {
		refused({ 'a.ts': CHECKS, 'b.ts': "export { check } from './a.ts';\n" }, 'b.ts').fails(
			'check runs behind a gate ($dev): import it from its own module'
		);
		refused({ 'a.ts': CHECKS, 'b.ts': "export * from './a.ts';\n" }, 'b.ts').fails(
			"export * from './a.ts' re-exports its marked functions (check, note)"
		);
		refused(
			{ 'a.ts': CHECKS, 'b.ts': lines("import * as a from './a.ts';", 'a.check(1);') },
			'b.ts'
		).fails("import * from './a.ts' hides the calls of its marked functions");
	});
});

describe('built', () => {
	/** The fixture bundled for production as an app builds it (the defines of the size gate,
	 *  apps/palaestra/e2e/bundle-size.ts), the rules tier on or off. */
	async function bundle(rules: boolean): Promise<string> {
		const build = await rolldown({
			input: join(FIXTURES, 'entry.ts'),
			plugins: [ogygia_macros({ runtime: join(FIXTURES, 'none.ts'), roots: [FIXTURES] })],
			resolve: { conditionNames: ['production', 'import', 'default'] },
			transform: {
				define: { 'import.meta.env.DEV': 'false', __OGYGIA_RULES__: String(rules) }
			},
			logLevel: 'silent'
		});
		const { output } = await build.generate({ format: 'esm', minify: true });
		return output[0].code;
	}

	test('a production build drops both functions and their calls', async () => {
		const code = await bundle(false);
		expect(code).not.toContain('dev-body');
		expect(code).not.toContain('rules-body');
		expect(code).toMatch(/\+\s*1/);
	});

	test('a rules build keeps the rules tier, and drops the dev one', async () => {
		const code = await bundle(true);
		expect(code).toContain('rules-body');
		expect(code).not.toContain('dev-body');
	});
});
