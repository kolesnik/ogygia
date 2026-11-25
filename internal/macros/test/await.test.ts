/**
 * `$await`: the await of a wait that may settle STALE, and the check after it, written by the build;
 * a plain await of one is refused.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STALE } from '@ogygia/machine';
import { describe, expect, test } from 'vitest';
import { check } from 'ogygia-internal-compilerkit/testing';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import { compile } from '../src/compile.ts';

const OPTIONS = { mode: 'dev', runtime: 'rt', reference: 'rt' } as const;
/** A module of `rows`, one line each, compiled. */
const out = (...rows: ReadonlyArray<string>) =>
	compile(rows.map((r) => `${r}\n`).join(''), 'a.ts', OPTIONS)?.code ?? null;
const IMPORT = "import { STALE } from '@ogygia/machine';";

describe('the shapes', () => {
	test('a statement gives up when the wait settles STALE', () => {
		expect(
			out(`${IMPORT}`, `async function f(turn) {`, `\t$await(turn.wait(1));`, `\tgo();`, `}`)
		).toBe(
			`${dedent`
				${IMPORT}
				async function f(turn) {
					if ((await turn.wait(1)) === STALE) return;
					go();
				}
			`}\n`
		);
	});

	test('a const, a let and an assignment check their binding', () => {
		const code = out(
			`${IMPORT}`,
			`async function f(s) {`,
			`\tconst a = $await(s.task(g));`,
			`\tlet b = $await(s.wait('x'));`,
			`\tb = $await(s.ask(h));`,
			`}`
		)!;
		expect(code).toContain('const a = await s.task(g); if (a === STALE) return;');
		expect(code).toContain("let b = await s.wait('x'); if (b === STALE) return;");
		expect(code).toContain('b = await s.ask(h); if (b === STALE) return;');
	});

	test('a statement written without its semicolon still ends before the check', () => {
		expect(
			out(`${IMPORT}`, `async function f(s) {`, `\tconst a = $await(s.task(g))`, `\tgo(a)`, `}`)
		).toContain('const a = await s.task(g); if (a === STALE) return;');
	});

	test('what to give up with is returned then; an if without braces gets them', () => {
		const code = out(
			`${IMPORT}`,
			`async function f(s, v) {`,
			`\tif (v) $await(s.task(g), null);`,
			`\tconst a = $await(s.task(g), v ?? 0);`,
			`}`
		)!;
		expect(code).toContain('if (v) { if ((await s.task(g)) === STALE) return null; }');
		expect(code).toContain('const a = await s.task(g); if (a === STALE) return v ?? 0;');
	});

	test("STALE is the file's own import when it has one, else the output imports it", () => {
		expect(out('async function f(s) {', '\t$await(s.task(g));', '\tgo();', '}')).toContain(
			"import { STALE } from '@ogygia/machine'"
		);
		expect(
			out(
				"import { STALE as S } from '@ogygia/machine';",
				'async function f(s) {',
				'\t$await(s.task(g));',
				'\tgo();',
				'}'
			)
		).toContain('if ((await s.task(g)) === S) return;');
	});

	test("a function's last statement gives up by ending: no check, and no STALE import for it", () => {
		expect(out('async function f(s) {', '\tgo();', '\t$await(s.task(g));', '}')).toBe(
			`${dedent`
				async function f(s) {
					go();
					await s.task(g);
				}
			`}\n`
		);
		expect(out('const f = async (s) => {', '\t$await(s.wait(1));', '};')).toContain(
			'await s.wait(1);\n};'
		);
		expect(
			out(IMPORT, 'class A {', '\tasync m(s) {', '\t\t$await(s.ask(h));', '\t}', '}')
		).toContain('\t\tawait s.ask(h);\n\t}');
	});

	test('a last statement with what to give up with, or one inside a block, keeps its check', () => {
		const code = out(
			IMPORT,
			'async function f(s, v) {',
			'\tif (v) {',
			'\t\t$await(s.task(g));',
			'\t}',
			'\ttry {',
			'\t\t$await(s.task(h));',
			'\t} finally {}',
			'\t$await(s.wait(1), v);',
			'}'
		)!;
		expect(code).toContain('if ((await s.task(g)) === STALE) return;');
		expect(code).toContain('if ((await s.task(h)) === STALE) return;');
		expect(code).toContain('if ((await s.wait(1)) === STALE) return v;');
	});
});

describe('refused', () => {
	const refused = (...rows: ReadonlyArray<string>) => check(() => out(...rows));

	test('a plain await of a task, a wait, an ask, or a catch of one, even with no macro in the file', () => {
		refused('async function f(s) {', '\tconst a = await s.task(g);', '}').fails(
			'a.ts:2:12  an await of a .task(…), .wait(…) or .ask(…) is written $await(…)'
		);
		refused('async function f(s) {', '\tawait s.wait(1).catch(h);', '}').fails(
			'is written $await(…)'
		);
		refused('async function f(s) {', '\tawait s.ask(h);', '}').fails('is written $await(…)');
	});

	test('$await outside an async function, or where its check has no statement', () => {
		refused('function f(s) {', '\t$await(s.task(g));', '}').fails('it sits in an async function');
		refused('async function f(s) {', '\tuse($await(s.task(g)));', '}').fails(
			'$await(…) is a statement'
		);
		refused('async function f(s) {', '\t$await();', '}').fails('$await(wait) takes the wait');
	});

	test('an await of anything else is no business of the build', () => {
		expect(out('async function f(u) {', '\tconst r = await fetch(u);', '}')).toBeNull();
	});
});

describe('run', () => {
	test('the compiled function gives up on STALE and goes on with a value', async () => {
		const code = out(
			IMPORT,
			'export async function f(s) {',
			"\tconst v = $await(s.wait(), 'gave up');",
			'\treturn `got ${v}`;',
			'}'
		)!;
		const dir = mkdtempSync(join(fileURLToPath(new URL('.', import.meta.url)), '.run-'));
		try {
			const file = join(dir, 'a.mjs');
			writeFileSync(file, stripTypeScriptTypes(code));
			const { f } = (await import(pathToFileURL(file).href)) as {
				f: (s: { wait(): Promise<unknown> }) => Promise<string>;
			};
			expect(await f({ wait: async () => 1 })).toBe('got 1');
			expect(await f({ wait: async () => STALE })).toBe('gave up');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});
