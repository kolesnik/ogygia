/**
 * Marks at the definition: the mark an initializer carries, a marked declaration's shape, a name
 * from a closed list, a name that may only be called, and the development check.
 */
import { describe, expect, test } from 'vitest';
import { DEV_CHECK, Emitter, Report, devOnly, parse, type N } from '../src/index.ts';
import { firstMisuse, markOf, markedDefinition, namedIn } from '../src/marks.ts';

const MARKS = { $fast: 0, '$fast.allow': 1 };
const program = (source: string): N => parse(source, new Report(source, 'x.ts'));

describe('markOf and markedDefinition', () => {
	test('the mark, its call and the function at its place', () => {
		const [plain, allowed, other] = program(`
      const a = $fast(function a() {})
      const b = $fast.allow('copy', function b() {})
      const c = $slow(function c() {})
    `).body.map((s: N) => s.declarations[0].init);
		expect(markOf(plain, MARKS)?.fn.id.name).toBe('a');
		expect(markOf(allowed, MARKS)?.mark).toBe('$fast.allow');
		expect(markOf(allowed, MARKS)?.fn.id.name).toBe('b');
		expect(markOf(other, MARKS)).toBeNull();
	});

	test('a const at the top whose function has its name is named; anything else is not', () => {
		const p = program(`
      export const a = $fast(function a() {})
      const b = $fast(function other() {})
      let c = $fast(function c() {})
      const d = $fast(() => 1)
      const e = $fast(function e() {}, 2)
      function f() { const g = $fast(function g() {}) }
      const h = 1
    `);
		const shape = (s: N, parent: N) => {
			const d = markedDefinition(s, parent, MARKS);
			return d === null ? null : [d.top, d.named, d.alone];
		};
		const [a, b, c, d, e, f, h] = p.body;
		expect(shape(a.declaration, a)).toEqual([true, true, true]);
		expect(shape(b, p)).toEqual([true, false, true]);
		expect(shape(c, p)).toEqual([true, false, true]);
		expect(shape(d, p)).toEqual([true, false, true]);
		expect(shape(e, p)).toEqual([true, true, false]);
		expect(shape(f.body.body[0], f.body)).toEqual([false, false, true]);
		expect(shape(h, p)).toBeNull();
	});
});

describe('namedIn', () => {
	const TABLE = { copy: 'handed to the app', frame: 'the next frame' };
	test('a string literal naming one of the closed list, else null', () => {
		const [a, b, c] = program(`f('copy', 'other', copy)`).body[0].expression.arguments;
		expect(namedIn(a, TABLE)).toBe('copy');
		expect(namedIn(b, TABLE)).toBeNull();
		expect(namedIn(c, TABLE)).toBeNull();
		expect(namedIn(program(`f('toString')`).body[0].expression.arguments[0], TABLE)).toBeNull();
	});
});

describe('firstMisuse', () => {
	const misuse = (source: string) => {
		const m = firstMisuse(program(source), new Set(['check']));
		return m === null ? null : [m.how, m.node.type];
	};
	test('calls as statements, declarations, imports and keys are fine', () => {
		expect(
			misuse(`import { check } from './c'
        export { check }
        check(1)
        if (x) check(2)
        const o = { check: 1, y: a.check }`)
		).toBeNull();
	});
	test('handed on as a value, or its result read', () => {
		expect(misuse(`run(check)`)).toEqual(['value', 'Identifier']);
		expect(misuse(`const o = { check }`)).toEqual(['value', 'Identifier']);
		expect(misuse(`const r = check(1)`)).toEqual(['expression', 'CallExpression']);
	});
});

describe('devOnly', () => {
	test('a call behind the check every bundler folds', () => {
		const source = 'check(1)\n';
		const report = new Report(source, 'x.ts');
		const p = parse(source, report);
		const e = new Emitter(source, report, new Set());
		devOnly(e, p.body[0].expression);
		expect(e.s.toString()).toBe(`${DEV_CHECK} && check(1)\n`);
		expect(DEV_CHECK).toBe("process.env.NODE_ENV !== 'production'");
	});
});
