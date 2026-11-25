/**
 * Could-allocate and sentinel-after-await: the places a per-frame function may make garbage, and
 * the awaits that skip their sentinel's check.
 */
import { describe, expect, test } from 'vitest';
import { Report, isCall, parse, type N } from '../src/index.ts';
import { allocations, pureCall } from '../src/alloc.ts';
import { giveUpAround, giveUpIf, rawAwaits } from '../src/sentinel.ts';

function first(source: string): N {
	return parse(source, new Report(source, 'x.ts')).body[0];
}

const said = (source: string, call: (n: N) => string | null = () => null) =>
	allocations(first(source), {
		call,
		skip: (n) => isCall(n, 'allowed')
	}).map((a) => a.what);

describe('could it allocate', () => {
	test('a function of numbers and plain reads allocates nothing', () => {
		expect(
			said(`function step(a: { x: number }, n: number) {
        let s = 0
        for (let i = 0; i < n; i++) s += a.x * i
        return s > 0 ? s : -s
      }`)
		).toEqual([]);
	});

	test('every kind of allocation is named', () => {
		expect(
			said(`async function step(...rest: number[]) {
        const o = { a: 1 }
        const l = [1]
        const f = () => 1
        const t = \`x\${o}\`
        const s = 'a' + t
        const n = new Map()
        const c = [...l]
        const [p] = l
        for (const x of l) void x
        const r = /x/
        await 1
      }`)
		).toEqual([
			'an async function (a promise per call)',
			'a rest parameter',
			'an object literal',
			'an array literal',
			'a closure',
			'a template literal',
			'string concatenation',
			'`new`',
			'an array literal',
			'a spread',
			'array destructuring (an iterator)',
			'`for…of` (an iterator)',
			'a regular expression',
			'`await`'
		]);
	});

	test('a call is the consumer’s to judge; an exception is not read', () => {
		const calls = (n: N) => (isCall(n, 'ok') ? null : 'not known to allocate nothing');
		expect(said('function f() { ok(); other(); allowed({ a: 1 }) }', calls)).toEqual([
			'not known to allocate nothing'
		]);
	});
});

describe('sentinel after await', () => {
	test('the check written for a bound wait and an unbound one', () => {
		expect(giveUpIf('done', { sentinel: '$.STALE', giveUp: '' })).toBe(
			'if (done === $.STALE) return'
		);
		expect(giveUpIf('done', { sentinel: 'GONE', giveUp: 'null' })).toBe(
			'if (done === GONE) return null'
		);
		expect(giveUpAround({ sentinel: 'GONE', giveUp: '' })).toEqual([
			'if ((await ',
			') === GONE) return'
		]);
	});

	test('the awaits of what may settle with the sentinel', () => {
		const source = 'async function f(s) { await s.task(g); await other(); await s.task(h) }';
		const program = parse(source, new Report(source, 'x.ts'));
		const found = rawAwaits(
			program,
			(n) => n.type === 'CallExpression' && n.callee.property?.name === 'task'
		);
		expect(found.map((n) => source.slice(n.start, n.end))).toEqual([
			'await s.task(g)',
			'await s.task(h)'
		]);
	});
});

describe('pureCall', () => {
	const pure = (source: string, classOf: (n: N) => string | null = () => null) =>
		pureCall(first(source).expression, classOf);

	test('pure globals and global functions make nothing', () => {
		expect(pure('Math.max(a, b)')).toBe(true);
		expect(pure('Number.isFinite(a)')).toBe(true);
		expect(pure('Array.isArray(a)')).toBe(true);
		expect(pure('Object.is(a, b)')).toBe(true);
		expect(pure('isNaN(a)')).toBe(true);
		expect(pure('Object.keys(a)')).toBe(false);
		expect(pure('Number.parseFloat(a)')).toBe(false);
		expect(pure('f(a)')).toBe(false);
		expect(pure('toString.call(a)')).toBe(false);
	});

	test('a lookup on a receiver declared with its class', () => {
		const declared = (cls: string) => (n: N) => (n.name === 'm' ? cls : null);
		expect(pure('m.get(k)', declared('Map'))).toBe(true);
		expect(pure('m.has(k)', declared('WeakSet'))).toBe(true);
		expect(pure('m.set(k, v)', declared('Map'))).toBe(false);
		expect(pure('m.get(k)', declared('Record'))).toBe(false);
		expect(pure('o.get(k)', declared('Map'))).toBe(false);
		expect(pure('m[k](1)', declared('Map'))).toBe(false);
	});
});
