/** A call graph across modules: named functions, their marks, calls and notes; the shortest
 *  path from a marked root to another kind, through relative imports. */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { Report, isCall, macroName, parse, type N } from '../src/index.ts';
import { fileCache } from '../src/modules.ts';
import { CallGraph, functionsOf, type Defined, type FunctionRules } from '../src/reach.ts';

type Mark = 'fast' | 'slow' | 'plain';

const RULES: FunctionRules<Mark> = {
	plain: 'plain',
	mark(init) {
		const m = macroName(init);
		if (m === '$fast' || m === '$slow')
			return { mark: m === '$fast' ? 'fast' : 'slow', fn: init.arguments[0] };
		return { mark: 'plain', fn: init };
	},
	skip: (n) => isCall(n, 'excused'),
	note: (n) => (isCall(n, 'measure') ? 'measure' : null)
};

const program = (source: string): N => parse(source, new Report(source, 'x.ts'));

const dir = mkdtempSync(join(tmpdir(), 'compilerkit-graph-'));
const lib = `export function deep() { measure() }
export const quick = $fast(function quick() { return 1 })
export const heavy = $slow(function heavy() {})
`;
writeFileSync(join(dir, 'lib.ts'), lib);
const load = fileCache((path, code) => functionsOf(path, program(code), RULES));

describe('functionsOf', () => {
	test('named functions with their marks, calls and first note; a skipped part is not read', () => {
		const fns = functionsOf(
			'/x.ts',
			program(`import { deep } from './lib.ts'
function a() { b(); excused(measure()); c.d() }
export const b = $fast(() => { measure(); measure() })
const c = 1
const e = $fast(1)
const f = function () { a() }`),
			RULES
		);
		const seen = [...fns.defined.values()].map((f) => [f.name, f.mark, f.calls, f.note]);
		expect(seen).toEqual([
			['a', 'plain', ['b'], null],
			['b', 'fast', ['measure', 'measure'], 'measure'],
			['f', 'plain', ['a'], null]
		]);
		expect(fns.imports.get('deep')?.name).toBe('deep');
	});
});

describe('CallGraph', () => {
	const here = functionsOf(
		join(dir, 'main.ts'),
		program(`import { deep, quick, heavy as h } from './lib'
export const root = $fast(function root() { step(); quick() })
function step() { h(); deep() }
export const calm = $fast(function calm() { quick(); missing() })`),
		RULES
	);
	const graph = new CallGraph(here, load);
	const measures = (fn: Defined<Mark>) => fn.note !== null;

	test('a name resolves through the imports, by the name exported', () => {
		expect(graph.definedAt(here, 'h')?.name).toBe('heavy');
		expect(graph.definedAt(here, 'h')?.mark).toBe('slow');
		expect(graph.definedAt(here, 'missing')).toBeNull();
	});

	test('the shortest path from a root to what it may not reach, across modules', () => {
		const root = here.defined.get('root')!;
		expect(graph.pathFrom(root, measures)?.map((f) => f.name)).toEqual(['root', 'step', 'deep']);
		expect(graph.pathFrom(here.defined.get('calm')!, measures)).toBeNull();
	});

	test('a step the proof may not cross ends the path there', () => {
		const root = here.defined.get('root')!;
		expect(graph.pathFrom(root, measures, (fn) => fn.name !== 'step')).toBeNull();
	});
});
