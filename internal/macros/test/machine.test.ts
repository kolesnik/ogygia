/**
 * `$machine`: a definition read and checked at build. A production build carries it as data
 * (`compiledRunDef`), dev and rules builds keep `runDef`; the two drive the same, move for move.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STALE } from '@ogygia/machine';
import * as rt from '@ogygia/machine';
import { rolldown } from 'rolldown';
import { describe, expect, test } from 'vitest';
import { ogygia_macros } from '../src/plugin.ts';
import { compile } from '../src/compile.ts';

const OPTIONS = { mode: 'dev', runtime: 'rt', reference: 'rt' } as const;
const out = (...rows: ReadonlyArray<string>) =>
	compile(rows.map((r) => `${r}\n`).join(''), 'a.ts', OPTIONS)?.code ?? null;
const fails = (...rows: ReadonlyArray<string>) => {
	try {
		out(...rows);
	} catch (error) {
		return String((error as Error).message);
	}
	throw new Error('compiled');
};

const HOLE = [
	`const steps = {`,
	`	idle: ['armed', 'fetching'],`,
	`	armed: ['idle', 'fetching'],`,
	`	fetching: ['idle', 'retrying', 'failed'],`,
	`	retrying: ['idle', 'armed', 'fetching'],`,
	`	failed: ['idle', 'armed', 'fetching']`,
	`} as const;`,
	`const WAIT = 250;`,
	`export const hole = $machine<S>()({`,
	`	name: 'hole',`,
	`	initial: 'idle',`,
	`	steps,`,
	`	after: { retrying: { ms: WAIT, to: 'fetching' }, failed: { ms: (s) => 10, to: 'idle' } }`,
	`});`
];

describe('the output', () => {
	test('production reads the definition as data; dev and rules builds run define on it', () => {
		const code = out(...HOLE)!;
		expect(code).toContain("import { runDef, compiledRunDef } from '@ogygia/machine'");
		expect(code).toContain(
			`compiledRunDef("hole", ["idle","armed","fetching","retrying","failed"], 0, [6, 5, 25, 7, 7], [[3, WAIT, 2], [4, (s) => 10, 0]])`
		);
		expect(code).toMatch(/\(RULES\w* \? runDef\(\{/);
	});

	test('the data is define’s own: names, initial, masks and timeouts alike', () => {
		const config = {
			name: 'hole',
			initial: 'idle',
			steps: {
				idle: ['armed', 'fetching'],
				armed: ['idle', 'fetching'],
				fetching: ['idle', 'retrying', 'failed'],
				retrying: ['idle', 'armed', 'fetching'],
				failed: ['idle', 'armed', 'fetching']
			},
			after: { retrying: { ms: 250, to: 'fetching' } }
		};
		const read = rt.runDef(config);
		const made = rt.compiledRunDef(
			'hole',
			['idle', 'armed', 'fetching', 'retrying', 'failed'],
			0,
			[6, 5, 25, 7, 7],
			[[3, 250, 2]]
		);
		expect([...made.names]).toEqual([...read.names]);
		expect(made.initial).toBe(read.initial);
		expect(made.words).toBe(read.words);
		expect([...made.masks]).toEqual([...read.masks]);
		expect(made.after.map((t) => t && [t.ms, t.to])).toEqual(
			read.after.map((t) => t && [t.ms, t.to])
		);
	});

	test('more than 32 states: each state’s steps take as many words as define’s', () => {
		const names = Array.from({ length: 40 }, (_, i) => `s${i}`);
		const tos = (i: number) => (i === 20 ? [names[21]!, 's5'] : [names[(i + 1) % 40]!]);
		const rows = names.map(
			(n, i) =>
				`\t${n}: [${tos(i)
					.map((t) => `'${t}'`)
					.join(', ')}],`
		);
		const code = out(
			`export const m = $machine<S>()({ name: 'm', initial: 's0', steps: {`,
			...rows,
			`} });`
		)!;
		const masks = /compiledRunDef\("m", \[[^\]]*\], 0, \[([^\]]*)\]\)/
			.exec(code)![1]!
			.split(', ')
			.map(Number);
		const read = rt.runDef({
			name: 'm',
			initial: 's0',
			steps: Object.fromEntries(names.map((n, i) => [n, tos(i)]))
		});
		expect(masks).toEqual([...read.masks]);
	});
});

describe('refused at build, as define would refuse at runtime', () => {
	const def = (steps: string, rest = '') =>
		fails(`export const m = $machine<S>()({ name: 'm', initial: 'a', steps: ${steps}${rest} });`);

	test('a step to a state that is not one', () => {
		expect(def(`{ a: ['b'], b: ['c'] }`)).toContain('"c", a step of "b", is not one of its states');
	});
	test('a step written twice', () => {
		expect(def(`{ a: ['b', 'b'], b: [] }`)).toContain('"a" lists "b" twice');
	});
	test('a state no step reaches', () => {
		expect(def(`{ a: [], b: ['a'] }`)).toContain('state "b" can never be reached from "a"');
	});
	test('an initial state that is not one', () => {
		expect(
			fails(`export const m = $machine<S>()({ name: 'm', initial: 'z', steps: { a: [] } });`)
		).toContain('its initial state "z" is not one of its states');
	});
	test('a timeout to a state that is not one of its steps, or with no time a timer holds', () => {
		expect(def(`{ a: ['b'], b: ['a'] }`, `, after: { a: { ms: 5, to: 'a' } }`)).toContain(
			'"a" is not one of its steps'
		);
		expect(def(`{ a: ['b'], b: ['a'] }`, `, after: { a: { ms: -1, to: 'b' } }`)).toContain(
			'its ms (-1) is not a time of 0 to'
		);
	});
	test('steps the build cannot read', () => {
		expect(def(`make()`)).toContain('its steps are an object literal');
		expect(fails(`const d = $machine<S>();`)).toContain('is one expression');
	});
});

describe('reference and compiled drive the same', () => {
	test('every move of a seeded walk lands alike, and so do its waits', async () => {
		const dir = mkdtempSync(join(fileURLToPath(new URL('.', import.meta.url)), '.run-'));
		try {
			const code = out(
				`import * as rt from '@ogygia/machine';`,
				...HOLE.map((r) => r.replace('$machine<S>()', '$machine<any>()')),
				`export const reference = rt.runDef({ name: 'hole', initial: 'idle', steps, after: { retrying: { ms: WAIT, to: 'fetching' }, failed: { ms: (s) => 10, to: 'idle' } } });`
			)!;
			const file = join(dir, 'm.mjs');
			// (the prod branch: the build's own data)
			writeFileSync(
				file,
				stripTypeScriptTypes(code.replace(/\(RULES\w* \?/, '(false ?'), { mode: 'strip' })
			);
			const { hole: compiled_def, reference } = (await import(pathToFileURL(file).href)) as {
				hole: rt.RunDef;
				reference: rt.RunDef;
			};
			const all = ['idle', 'armed', 'fetching', 'retrying', 'failed', 'gone'];
			let seed = 7;
			const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % all.length;
			for (let run = 0; run < 50; run++) {
				const make = rt.createRun as unknown as (def: rt.RunDef) => rt.Run;
				const a = make(compiled_def);
				const b = make(reference);
				const waits: Promise<unknown>[][] = [[], []];
				for (let step = 0; step < 20; step++) {
					const to = all[next()]!;
					if (step % 5 === 0) {
						const target = all[next() % 5]!;
						waits[0]!.push(a.wait(target));
						waits[1]!.push(b.wait(target));
					}
					// every third step a move from a state drawn at random: taken, lost, or refused
					const from = step % 3 === 2 ? all[next()]! : null;
					const moved = (m: rt.Run): unknown => {
						try {
							return from === null ? m.go(to) : m.move(from, to);
						} catch (error) {
							return String(error);
						}
					};
					expect(moved(a)).toEqual(moved(b));
					expect(a.kind).toBe(b.kind);
					expect(a.epoch).toBe(b.epoch);
				}
				a.stop();
				b.stop();
				const [wa, wb] = await Promise.all(waits.map((w) => Promise.all(w)));
				expect(wa!.map((v) => (v === STALE ? 'STALE' : (v as { kind: string }).kind))).toEqual(
					wb!.map((v) => (v === STALE ? 'STALE' : (v as { kind: string }).kind))
				);
			}
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe('built', () => {
	const FIXTURES = fileURLToPath(new URL('./fixtures/machine/', import.meta.url));
	/** The fixture bundled as an app builds it, dev, rules or production. */
	async function bundle(dev: boolean, rules: boolean): Promise<string> {
		const build = await rolldown({
			input: join(FIXTURES, 'entry.ts'),
			plugins: [ogygia_macros({ runtime: join(FIXTURES, 'none.ts'), roots: [FIXTURES] })],
			resolve: { conditionNames: ['production', 'import', 'default'] },
			transform: {
				define: { 'import.meta.env.DEV': String(dev), __OGYGIA_RULES__: String(rules) }
			},
			logLevel: 'silent'
		});
		const { output } = await build.generate({ format: 'esm', minify: true });
		return output[0].code;
	}
	/** Text only `define`'s reading and checks carry. */
	const DEFINE = 'a timer holds no more';

	test('a production build carries the definition as data, and none of define', async () => {
		const code = await bundle(false, false);
		expect(code).toMatch(/.fold-toggle.,\[.off.,.on.\],0,\[2,1\]/);
		expect(code).not.toContain(DEFINE);
	});

	test('a rules build reads it with define, with its checks', async () => {
		expect(await bundle(false, true)).toContain(DEFINE);
	});

	test('a dev build reads it with define, with its checks', async () => {
		expect(await bundle(true, false)).toContain(DEFINE);
	});
});
