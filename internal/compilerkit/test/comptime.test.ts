/**
 * Build-time evaluation: an expression run with pure globals and named bindings only, and its
 * result checked to be data before it is written as a literal.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
	NotConstant,
	UnknownAtBuild,
	constantsOf,
	dataLiteral,
	evaluateIn,
	evaluate,
	freeNames,
	isData
} from '../src/comptime.ts';

describe('comptime', () => {
	test('runs TypeScript with pure globals and the values it is handed', () => {
		expect(evaluate('(() => [1, 2].map((n: number) => n * K))()', { K: 3 })).toEqual([3, 6]);
		expect(evaluate('Math.max(...[1, 5, 2])')).toBe(5);
		expect(freeNames('a + Math.PI + b')).toEqual(['a', 'b']);
	});

	test('a name the build does not know is an error naming it', () => {
		expect(() => evaluate('window.innerWidth')).toThrow(UnknownAtBuild);
		expect(() => evaluate('window.innerWidth')).toThrow(
			'reads "window", which isn\'t known at build time.'
		);
	});

	test('only data is written: finite numbers, strings, booleans, null, arrays, plain objects', () => {
		expect(dataLiteral({ a: [1, 'x', true, null] })).toBe('{"a":[1,"x",true,null]}');
		for (const bad of [
			NaN,
			Infinity,
			undefined,
			() => 1,
			new Map(),
			new (class A {})(),
			Symbol('s')
		])
			expect(isData(bad)).toBe(false);
		expect(dataLiteral(new Set())).toBeNull();
	});
});

describe('constants across modules', () => {
	const dir = mkdtempSync(join(tmpdir(), 'compilerkit-comptime-'));
	writeFileSync(
		join(dir, 'edges.ts'),
		`export const EDGES = ['left', 'top'] as const
export const SIDES = $made(function sides() { return EDGES.length * 2 })
import type { T } from './t.ts'
`
	);
	const load = (file: string) =>
		constantsOf(`${file}.ts`, readFileSync(`${file}.ts`, 'utf8'), {
			$made: 0
		});
	const here = constantsOf(
		join(dir, 'main.ts'),
		`import { EDGES, SIDES as S } from './edges'
import type { Shape } from './shape'
const ONE = 1 satisfies number
const LOOP = LOOP + 1
const BAD = window.x
export const MASK = $made(function mask() { return EDGES.map((e, i) => [e, ONE << i]) })`,
		{ $made: 0 }
	);

	test('each const by its source; a marked one is its function; value imports only', () => {
		expect(here.consts.get('ONE')).toBe('1');
		expect(here.consts.get('MASK')).toMatch(/^\(function mask\(\)/);
		expect([...here.imports.keys()]).toEqual(['EDGES', 'S']);
		expect(here.imports.get('S')?.name).toBe('SIDES');
	});

	test('code reads constants here and in the modules imported, each run first', () => {
		expect(evaluateIn(here, '(MASK)()', load)).toEqual([
			['left', 1],
			['top', 2]
		]);
		expect(evaluateIn(here, 'S() + ONE', load)).toBe(5);
	});

	test('a name that is no constant (a global too), one that reads itself', () => {
		expect(() => evaluateIn(here, 'NONE + 1', load)).toThrow(new NotConstant('NONE', false));
		expect(() => evaluateIn(here, 'LOOP', load)).toThrow('"LOOP" reads itself.');
		expect(() => evaluateIn(here, 'BAD', load)).toThrow(new NotConstant('window', false));
		expect(() => evaluateIn(here, 'Math.max(ONE, 2)', load)).not.toThrow();
	});
});
