/**
 * Option bags checked at build (src/options-pass.ts): a maker of `@ogygia/machine` called with options
 * the build reads is checked by the machine's own checks, fails the build with the code the runtime
 * would throw, and then makes its value unchecked; a `policy({ … })` is its frozen data. Options the
 * checks need and the build cannot read keep the runtime check, and the boot link (whose makers are
 * unchecked) refuses them.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { policy } from '@ogygia/machine';
import { describe, expect, test } from 'vitest';
import { runInNewContext } from 'node:vm';
import { compile } from '../src/compile.ts';

const OPTIONS = { mode: 'dev', runtime: 'rt', reference: 'rt' } as const;
const IMPORTS = "import { cache, flights, policy, queue, say } from '@ogygia/machine';";
const lines = (...rows: ReadonlyArray<string>): string => rows.map((r) => `${r}\n`).join('');
const out = (...rows: ReadonlyArray<string>) =>
	compile(lines(IMPORTS, ...rows), 'a.ts', OPTIONS)?.code ?? null;
const fails = (...rows: ReadonlyArray<string>) => {
	try {
		out(...rows);
	} catch (error) {
		return String((error as Error).message);
	}
	throw new Error('compiled');
};

describe('a literal the checks pass: made unchecked', () => {
	test('each maker calls its trusted form, from the internal entry', () => {
		const code = out(
			"export const a = flights({ name: 'a', run: async () => 1, max: 8 });",
			"export const b = flights.keyed<{ id: string }>()({ key: ['id'], run: async () => 1 });",
			"export const c = cache({ name: 'c', max: 64, keep: 60 * 1000 });",
			'export const d = queue({ max: 2, windows: [{ max: 1, holds: () => true }] });',
			'export const e = say();',
			'export const f = say({ max: 32 });'
		)!;
		expect(code).toContain('trusted_flights');
		expect(code).toContain('trusted_cache');
		expect(code).toContain('trusted_queue');
		expect(code).toContain('trusted_say');
		expect(code).toMatch(/import \{[^}]*trusted_flights[^}]*\} from '@ogygia\/machine\/internal'/);
		expect(code).not.toMatch(/\b(?:flights|cache|queue|say)\(/);
		expect(code).not.toContain('.keyed');
	});

	test('a module const, a function the module declares, and a value the checks never read are read', () => {
		const code = out(
			'const MAX = 16;',
			'async function load() { return 1; }',
			'declare const owner: object;',
			"export const a = flights({ name: 'a', run: load, max: MAX, owner, touches: (x) => [x] });"
		)!;
		expect(code).toContain('trusted_flights(');
	});

	test('a policy is its frozen data: no maker runs at runtime', () => {
		const code = out(
			'export const p = policy({ attempts: 3, backoff: [500, 1000], jitter: 0, deadline: Infinity });',
			'export const q = policy({ attempts: 1 });'
		)!;
		expect(code).not.toMatch(/\bpolicy\(/);
		const made = (src: string) => runInNewContext(`(${src})`) as unknown;
		const p = made(/p = (.*);/.exec(code)![1]);
		expect(p).toEqual(policy({ attempts: 3, backoff: [500, 1000], jitter: 0, deadline: Infinity }));
		expect(Object.isFrozen(p)).toBe(true);
		expect(Object.isFrozen((p as { backoff: unknown }).backoff)).toBe(true);
		expect(made(/q = (.*);/.exec(code)![1])).toEqual(policy({ attempts: 1 }));
	});
});

describe("the runtime's lean makers (`@ogygia/machine/internal`)", () => {
	const INTERNAL = "import { lru, pass_queue, plain_flights } from '@ogygia/machine/internal';";
	const lean = (...rows: ReadonlyArray<string>) =>
		compile(lines(INTERNAL, ...rows), 'a.ts', OPTIONS)?.code ?? null;
	const lean_fails = (...rows: ReadonlyArray<string>) => {
		try {
			lean(...rows);
		} catch (error) {
			return String((error as Error).message);
		}
		throw new Error('compiled');
	};

	test('each is checked as its public maker is, and calls its trusted lean form', () => {
		const code = lean(
			"export const a = plain_flights({ name: 'a', run: async () => 1 });",
			"export const b = plain_flights.keyed<{ id: string }>()({ key: ['id'], run: async () => 1 });",
			"export const c = lru({ name: 'c', max: 64 });",
			"export const d = pass_queue({ name: 'd', budget: { ms: 30, yield: (f: () => void) => f() }, start: () => {} });"
		)!;
		expect(code).toContain('trusted_plain_flights');
		expect(code).toContain('trusted_lru');
		expect(code).toContain('trusted_pass_queue');
		expect(code).not.toMatch(/\b(?:plain_flights|lru|pass_queue)\(/);
		expect(code).not.toContain('.keyed');
	});

	test.each([
		["plain_flights({ name: 'a', run: async () => 1, max: Infinity })", /max/],
		[
			"plain_flights({ name: 'a', run: async () => 1, weigh: () => 1, max: 9 })",
			/flights\(\) only/
		],
		[
			"plain_flights.keyed<{ a: string; b: string }>()({ key: ['a', 'b'], run: async () => 1 })",
			/flights\(\) only/
		],
		["lru({ name: 'c', max: 0 })", /max/],
		['pass_queue({ max: 1.5 })', /max/]
	])('%s fails the build', (call, rule) => {
		const message = lean_fails(`export const x = ${call};`);
		expect(message).toContain('machine_bad_option');
		expect(message).toMatch(rule);
	});

	test('a public maker of the same name is not one of them', () => {
		const code = out("export const a = flights({ name: 'a', run: async () => 1 });")!;
		expect(code).toContain('trusted_flights');
		expect(code).not.toContain('trusted_plain_flights');
	});
});

describe('a literal the checks refuse: the build fails with the runtime code', () => {
	test.each([
		["flights({ name: 'a', run: async () => 1, max: Infinity })", /max/],
		["flights({ name: 'a', run: 'no' })", /run/],
		["flights({ run: async () => 1, key: ['id', 'id'] })", /key/],
		['flights.keyed<{ id: string }>()({ run: async () => 1 })', /key/],
		['flights({ run: async () => 1, weigh: () => 1 })', /max/],
		['flights({ run: async () => 1, keep: -1 })', /keep/],
		["cache({ name: 'c', max: 0 })", /max/],
		['queue({ max: 1.5 })', /max/],
		['queue({ windows: [{ max: 0, holds: () => true }] })', /windows\[0\]\.max/],
		['say({ max: 0 })', /max/],
		['policy({ attempts: 0 })', /attempts/],
		['policy({ jitter: 2 })', /jitter/]
	])('%s', (call, option) => {
		const message = fails(`export const x = ${call};`);
		expect(message).toContain('machine_bad_option');
		expect(message).toMatch(option);
	});
});

test('a cache with no bound fails the build, as it throws in dev (production would refuse it)', () => {
	expect(fails("export const c = cache({ name: 'c', max: Infinity });")).toMatch(
		/machine_bad_option.*max/s
	);
});

describe('options the build cannot read', () => {
	test('a value the checks read stays checked at runtime, and the build says so', () => {
		const code = lines(
			IMPORTS,
			'declare const n: number;',
			'export const a = cache({ name: "a", max: n });'
		);
		const result = compile(code, 'a.ts', OPTIONS);
		expect(result?.code ?? code).toContain('cache({');
		expect(result?.code ?? '').not.toContain('trusted_cache');
		expect(result?.warnings.join('\n')).toMatch(/keeps its runtime check.*max/s);
	});

	test('an option whose check is its type alone (a run, a retry) is taken as typed', () => {
		const code = out(
			'declare const make: () => () => Promise<number>;',
			'declare const retry: ReturnType<typeof policy>;',
			"export const a = flights({ name: 'a', run: make(), retry });"
		)!;
		expect(code).toContain('trusted_flights(');
		expect(fails("export const b = flights({ name: 'b', run: make(), max: 0 });")).toContain(
			'machine_bad_option'
		);
	});

	test('options not written in place stay checked at runtime', () => {
		const code = out('declare const o: never;', 'export const a = queue(o);');
		expect(code ?? '').not.toContain('trusted_queue');
	});

	test("the boot link's makers are unchecked: a linked call the build cannot read is refused", () => {
		const linked = (call: string) =>
			compile(
				lines(
					"import { boot_link, L_FLIGHTS, L_CACHE } from './link';",
					'declare const n: number;',
					`export const x = ${call};`
				),
				'a.ts',
				OPTIONS
			);
		expect(() => linked("boot_link()[L_CACHE]({ name: 'a', max: n })")).toThrow(/boot link.*max/s);
		expect(() =>
			linked(
				'boot_link()[L_FLIGHTS].keyed<{ id: string }>()({ key: ["id"], run: async () => 1, max: 0 })'
			)
		).toThrow(/machine_bad_option/);
		const ok = linked("boot_link()[L_CACHE]({ name: 'a', max: 512 })");
		expect(ok === null || ok.code.includes('boot_link()[L_CACHE]({')).toBe(true);
	});

	test('a policy imported from another module of the build is read (a retry of flights)', () => {
		const dir = mkdtempSync(join(tmpdir(), 'og-options-'));
		mkdirSync(dir, { recursive: true });
		writeFileSync(
			join(dir, 'policies.ts'),
			lines(
				"import { policy } from '@ogygia/machine';",
				'export const download = policy({ attempts: 2, backoff: 0, jitter: 0, deadline: Infinity });'
			)
		);
		const file = join(dir, 'a.ts');
		const src = lines(
			"import { flights } from '@ogygia/machine';",
			"import { download } from './policies.ts';",
			"export const a = flights({ name: 'a', run: async () => 1, retry: download });"
		);
		writeFileSync(file, src);
		const result = compile(src, 'a.ts', { ...OPTIONS, path: file });
		expect(result?.code).toContain('trusted_flights(');
	});

	test('a local of the same name is not the maker', () => {
		const code = out(
			'export function make(cache: (o: object) => unknown) {',
			"	return cache({ max: 0, name: 'local' });",
			'}'
		);
		expect(code ?? '').not.toContain('trusted_cache');
	});
});
