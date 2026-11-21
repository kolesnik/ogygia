/**
 * `$machine`: a definition read and checked at build. A production build carries it as data
 * (`compiledRunDef`, no state names) and its machines' call sites as its states' ints; dev and rules
 * builds keep `runDef` and the names; the two drive the same, move for move.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STALE } from '@ogygia/machine';
import * as rt from '@ogygia/machine';
import { rolldown } from 'rolldown';
import { afterAll, describe, expect, test } from 'vitest';
import { MachineTypes, ogygia_macros } from '../src/plugin.ts';
import { compile } from '../src/compile.ts';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const MACROS_D_TS = fileURLToPath(new URL('../macros.d.ts', import.meta.url));
const OPTIONS = { mode: 'dev', runtime: 'rt', reference: 'rt' } as const;
const lines = (rows: ReadonlyArray<string>) => rows.map((r) => `${r}\n`).join('');

/** Compiled without types: a definition's own checks run before anything asks for them. */
const out = (...rows: ReadonlyArray<string>) => compile(lines(rows), 'a.ts', OPTIONS)?.code ?? null;
const fails_with = (run: () => unknown): string => {
	try {
		run();
	} catch (error) {
		return String((error as Error).message);
	}
	throw new Error('compiled');
};
const fails = (...rows: ReadonlyArray<string>) => fails_with(() => out(...rows));

/** A package of its own on disk (its tsconfig, its files), compiled as a package build compiles
 *  it: with its types. */
class Package {
	readonly dir = mkdtempSync(join(HERE, '.types-'));
	readonly types: MachineTypes;
	constructor(files: Readonly<Record<string, ReadonlyArray<string>>>) {
		for (const [name, rows] of Object.entries(files))
			writeFileSync(join(this.dir, name), lines(rows));
		writeFileSync(
			join(this.dir, 'tsconfig.json'),
			JSON.stringify({
				compilerOptions: {
					strict: true,
					target: 'esnext',
					module: 'esnext',
					moduleResolution: 'bundler',
					allowImportingTsExtensions: true,
					noEmit: true,
					skipLibCheck: true,
					types: []
				},
				include: ['*.ts', MACROS_D_TS]
			})
		);
		this.types = new MachineTypes(join(this.dir, 'tsconfig.json'));
		packages.push(this);
	}
	compile(name: string): string {
		const path = join(this.dir, name);
		const code = this.types.typed.program.getSourceFile(path)!.text;
		return compile(code, name, { ...OPTIONS, path, types: this.types })?.code ?? code;
	}
	fails(name: string): string {
		return fails_with(() => this.compile(name));
	}
}
const packages: Package[] = [];
afterAll(() => {
	for (const p of packages) rmSync(p.dir, { recursive: true, force: true });
});

const HOLE_STEPS = [
	`const steps = {`,
	`	idle: ['armed', 'fetching'],`,
	`	armed: ['idle', 'fetching'],`,
	`	fetching: ['idle', 'retrying', 'failed'],`,
	`	retrying: ['idle', 'armed', 'fetching'],`,
	`	failed: ['idle', 'armed', 'fetching']`,
	`} as const;`,
	`const WAIT = 250;`
];
const HOLE_TYPES = [
	`import { createRun, type Run, type StateOf } from '@ogygia/machine';`,
	`type S = { idle: {}; armed: {}; fetching: { tries: number }; retrying: { tries: number }; failed: {} };`,
	`type Hole = Run<S, typeof steps>;`
];
const HOLE = [
	...HOLE_STEPS,
	`export const hole = $machine<S>()({`,
	`	name: 'hole',`,
	`	initial: 'idle',`,
	`	steps,`,
	`	after: { retrying: { ms: WAIT, to: 'fetching' }, failed: { ms: (s) => 10, to: 'idle' } }`,
	`});`
];

describe('the output', () => {
	test('production reads the definition as data, with no state names; dev and rules builds run define on it', () => {
		const p = new Package({ 'a.ts': [...HOLE_TYPES, ...HOLE] });
		const code = p.compile('a.ts');
		expect(code).toContain("import { runDef, compiledRunDef } from '@ogygia/machine'");
		expect(code).toContain(
			`compiledRunDef("hole", 5, 0, [6, 5, 25, 7, 7], [[3, WAIT, 2], [4, (s) => 10, 0]])`
		);
		expect(code).toMatch(/\(RULES\w* \? runDef\(\{/);
	});

	test('the data is define’s own: states, initial, masks and timeouts alike', () => {
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
		const made = rt.compiledRunDef('hole', 5, 0, [6, 5, 25, 7, 7], [[3, 250, 2]]);
		expect(made.names).toBe(null);
		expect(made.size).toBe(read.names!.length);
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
		const p = new Package({
			'a.ts': [
				`export const m = $machine<any>()({ name: 'm', initial: 's0', steps: {`,
				...rows,
				`} });`
			]
		});
		const masks = /compiledRunDef\("m", 40, 0, \[([^\]]*)\]\)/
			.exec(p.compile('a.ts'))![1]!
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

describe('call sites', () => {
	const p = new Package({
		'hole.ts': [
			...HOLE_TYPES,
			...HOLE,
			`export class Region {`,
			`	#hole: Hole = createRun(hole);`,
			`	arm(): boolean { return this.#hole.go('armed'); }`,
			`	fetch(again: boolean): boolean { return this.#hole.go(again ? 'retrying' : 'fetching', { tries: 1 }); }`,
			`	lost(): boolean { return this.#hole.move('fetching', 'failed'); }`,
			`	until() { return this.#hole.wait('failed'); }`,
			`	busy(): boolean { return this.#hole?.kind === 'fetching' || 'retrying' !== this.#hole.kind; }`,
			`	tries(): number { const s = this.#hole.now; return s.kind === 'fetching' ? s.tries : 0; }`,
			`	word(): string { switch (this.#hole.kind) { case 'idle': return 'rest'; case \`armed\`: return 'set'; default: return 'on'; } }`,
			`	open(): boolean { const kind = this.#hole.kind; return kind === 'idle' || kind === 'armed'; }`,
			`}`,
			`export function told(s: StateOf<S>): boolean { return s.kind !== 'failed'; }`
		]
	});
	const code = p.compile('hole.ts');
	const at = (name: string, k: number) => `(RULES ? ${JSON.stringify(name)} : ${k})`;

	test('a move, a lost move and a wait name their states’ ints in a production build', () => {
		expect(code).toContain(`this.#hole.go(${at('armed', 1)})`);
		expect(code).toContain(
			`this.#hole.go(again ? ${at('retrying', 3)} : ${at('fetching', 2)}, { tries: 1 })`
		);
		expect(code).toContain(`this.#hole.move(${at('fetching', 2)}, ${at('failed', 4)})`);
		expect(code).toContain(`this.#hole.wait(${at('failed', 4)})`);
	});

	test('a state read is compared or switched on by int, through a const, a now and a StateOf too', () => {
		expect(code).toContain(
			`this.#hole?.kind === ${at('fetching', 2)} || ${at('retrying', 3)} !== this.#hole.kind`
		);
		expect(code).toContain(`s.kind === ${at('fetching', 2)} ? s.tries : 0`);
		expect(code).toContain(`case ${at('idle', 0)}: return 'rest'; case ${at('armed', 1)}:`);
		expect(code).toContain(`kind === ${at('idle', 0)} || kind === ${at('armed', 1)}`);
		expect(code).toContain(`s.kind !== ${at('failed', 4)}`);
	});

	test('a definition compiles only with the package’s types', () => {
		expect(fails(...HOLE)).toContain(
			"a $machine definition compiles only with the package's types"
		);
	});
});

describe('refused at build: a site the types cannot tie to its definition', () => {
	const site = (...rows: ReadonlyArray<string>) =>
		new Package({ 'a.ts': [...HOLE_TYPES, ...HOLE, ...rows] }).fails('a.ts');

	test('a machine of no one definition (a bare Run, a type parameter)', () => {
		expect(site(`export const f = (m: Run) => m.go('armed');`)).toContain(
			'the build cannot tell which machine this is'
		);
		expect(site(`export const f = <T,>(m: Run<S, T>) => m.kind === 'idle';`)).toContain(
			'the build cannot tell which machine this is'
		);
	});

	test('a state named by anything but a literal', () => {
		expect(site(`export const f = (m: Hole, to: 'idle' | 'armed') => m.go(to);`)).toContain(
			'a state of machine hole is written out here'
		);
	});

	test('a state read for its value', () => {
		expect(site(`export const f = (m: Hole): string => m.kind;`)).toContain(
			"machine hole's state is read here for its value"
		);
		expect(
			site(`export const f = (m: Hole): string => { const k = m.kind; return String(k); };`)
		).toContain("k keeps machine hole's state");
	});

	test('a state that is not one of its machine’s', () => {
		expect(site(`export const f = (m: Hole) => m.kind === ('gone' as 'idle');`)).toContain(
			'"gone" is not a state of machine hole'
		);
	});

	test('code that runs only behind a gate keeps its names, as the builds it runs in do', () => {
		const p = new Package({
			'a.ts': [
				...HOLE_TYPES,
				...HOLE,
				`export const note: (m: Hole) => void = $rules(function note(m: Hole): void { console.log(m.kind); });`,
				`export function f(m: Hole): void { note(m); }`
			]
		});
		expect(p.compile('a.ts')).toContain('console.log(m.kind)');
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
	/** The module `name` of `p`, compiled, as one build runs it: production (`RULES` false) or rules. */
	async function load(p: Package, name: string, rules: boolean): Promise<Record<string, unknown>> {
		const code = p.compile(name).replace(/^const (RULES\w*) = .*$/m, `const $1 = ${rules};`);
		const file = join(p.dir, `${name}.${rules ? 'rules' : 'prod'}.mjs`);
		writeFileSync(file, stripTypeScriptTypes(code, { mode: 'strip' }));
		return (await import(pathToFileURL(file).href)) as Record<string, unknown>;
	}

	test('every move of a seeded walk lands alike, by int and by name, and so do its waits', async () => {
		const p = new Package({ 'a.ts': [...HOLE_TYPES, ...HOLE] });
		const { hole: compiled_def } = await load(p, 'a.ts', false);
		const reference = rt.runDef({
			name: 'hole',
			initial: 'idle',
			steps: {
				idle: ['armed', 'fetching'],
				armed: ['idle', 'fetching'],
				fetching: ['idle', 'retrying', 'failed'],
				retrying: ['idle', 'armed', 'fetching'],
				failed: ['idle', 'armed', 'fetching']
			},
			after: { retrying: { ms: 250, to: 'fetching' }, failed: { ms: () => 10, to: 'idle' } }
		});
		const names = [...reference.names!];
		const all = names;
		let seed = 7;
		const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % all.length;
		const make = rt.createRun as unknown as (def: rt.RunDef) => rt.Run;
		/** A state as each machine is moved: the compiled one by int, the reference by name. */
		const int = (name: string) => names.indexOf(name);
		for (let run = 0; run < 50; run++) {
			const a = make(compiled_def as rt.RunDef);
			const b = make(reference);
			const waits: Promise<unknown>[][] = [[], []];
			for (let step = 0; step < 20; step++) {
				const to = all[next()]!;
				if (step % 5 === 0) {
					const target = all[next() % 5]!;
					waits[0]!.push(a.wait(int(target) as never));
					waits[1]!.push(b.wait(target));
				}
				// every third step a move from a state drawn at random: taken, lost, or refused
				const from = step % 3 === 2 ? all[next()]! : null;
				const moved = (m: rt.Run, key: (name: string) => string | number): unknown => {
					try {
						return from === null
							? m.go(key(to) as never)
							: m.move(key(from) as never, key(to) as never);
					} catch (error) {
						return (error as rt.MachineError).code;
					}
				};
				expect(moved(a, int)).toEqual(moved(b, (n) => n));
				expect(names[a.kind as unknown as number]).toBe(b.kind);
				expect(a.epoch).toBe(b.epoch);
			}
			a.stop();
			b.stop();
			const [wa, wb] = await Promise.all(waits.map((w) => Promise.all(w)));
			const kinds = (list: unknown[], name: (k: unknown) => unknown) =>
				list.map((v) => (v === STALE ? 'STALE' : name((v as { kind: unknown }).kind)));
			expect(kinds(wa!, (k) => names[k as number])).toEqual(kinds(wb!, (k) => k));
		}
	});

	test('a module’s call sites move its machine alike in a production build and a rules build', async () => {
		const p = new Package({
			'a.ts': [
				...HOLE_TYPES,
				...HOLE,
				`export function walk(): string[] {`,
				`	const m: Hole = createRun(hole);`,
				`	const seen: string[] = [];`,
				`	const say = () => { switch (m.kind) { case 'idle': return 'idle'; case 'armed': return 'armed'; case 'fetching': return 'fetching'; case 'retrying': return 'retrying'; default: return 'failed'; } };`,
				`	seen.push(say(), String(m.go('armed')), say(), String(m.move('idle', 'fetching')));`,
				`	seen.push(String(m.go('fetching', { tries: 1 })), say(), String(m.move('fetching', 'retrying', { tries: 2 })));`,
				`	const s = m.now;`,
				`	seen.push(say(), String(s.kind === 'retrying' && s.tries === 2), String(m.go('idle')), say());`,
				`	m.stop();`,
				`	return seen;`,
				`}`
			]
		});
		const prod = (await load(p, 'a.ts', false)).walk as () => string[];
		const rules = (await load(p, 'a.ts', true)).walk as () => string[];
		expect(prod()).toEqual(rules());
		expect(rules()).toEqual([
			'idle',
			'true',
			'armed',
			'false',
			'true',
			'fetching',
			'true',
			'retrying',
			'true',
			'true',
			'idle'
		]);
	});
});

describe('built', () => {
	const FIXTURES = fileURLToPath(new URL('./fixtures/machine/', import.meta.url));
	/** The fixture bundled as an app builds it, dev, rules or production. */
	async function bundle(dev: boolean, rules: boolean): Promise<string> {
		const build = await rolldown({
			input: join(FIXTURES, 'entry.ts'),
			plugins: [
				ogygia_macros({
					runtime: join(FIXTURES, 'none.ts'),
					roots: [FIXTURES],
					types: join(FIXTURES, 'tsconfig.json')
				})
			],
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
	/** What a bundle's module says: its machine is on. */
	async function run(code: string): Promise<unknown> {
		const dir = mkdtempSync(join(HERE, '.run-'));
		try {
			writeFileSync(join(dir, 'm.mjs'), code);
			return ((await import(pathToFileURL(join(dir, 'm.mjs')).href)) as { on: unknown }).on;
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}

	test('a production build carries the definition as data, and no state name, and none of define', async () => {
		const code = await bundle(false, false);
		expect(code).toMatch(/.fold-toggle.,2,0,\[2,1\]/);
		expect(code).not.toMatch(/["'`](?:on|off)["'`]/);
		expect(code).not.toContain(DEFINE);
		expect(await run(code)).toBe(true);
	});

	test('a rules build reads it with define, with its checks, and names its states', async () => {
		const code = await bundle(false, true);
		expect(code).toContain(DEFINE);
		expect(code).toMatch(/["'`]on["'`]/);
		expect(await run(code)).toBe(true);
	});

	test('a dev build reads it with define, with its checks, and names its states', async () => {
		const code = await bundle(true, false);
		expect(code).toContain(DEFINE);
		expect(code).toMatch(/["'`]on["'`]/);
		expect(await run(code)).toBe(true);
	});
});
