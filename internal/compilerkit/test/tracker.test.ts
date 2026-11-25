/**
 * The tracker: a classifier decides each declaration's binding once, by its type or its
 * initializer; reads resolve to it, through aliases and `this` fields too.
 */
import { walk } from 'zimmerframe';
import { describe, expect, test } from 'vitest';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import { Report, Tracker, isCall, parse, type Classifier, type N } from '../src/index.ts';

type B = { kind: 'box' } | { kind: 'lid' };

const boxes: Classifier<B> = {
	aliases: ['box'],
	tracked: { box: 'Box' },
	keeps: (kind, type) => kind === 'box' && type === 'Box',
	typed: (type) => (type === 'Box' ? { kind: 'box' } : null),
	init: (init) => (isCall(init, 'box') ? { kind: 'box' } : null),
	member(node, scope, t) {
		return node.property?.name === 'lid' && t.resolve(scope, node.object)?.kind === 'box'
			? { kind: 'lid' }
			: undefined;
	}
};

/** Each `read(x)` call's argument, resolved where it is. */
function reads(source: string): Array<string | undefined> {
	const report = new Report(source, 'x.ts');
	const program = parse(source, report);
	const t = new Tracker<B>(program, report, [boxes]);
	t.collect();
	const out: Array<string | undefined> = [];
	walk(program as N, t.root, {
		_(node: N, { state, next }) {
			const scope = t.scopeAt(node, state);
			if (isCall(node, 'read')) out.push(t.resolve(scope, node.arguments[0])?.kind);
			next(scope);
		}
	});
	return out;
}

describe('the tracker', () => {
	test('a binding by initializer, by type, by alias, and through a member', () => {
		expect(
			reads(`
        const a = box()
        const b: Box = make()
        const c = a
        const d = other()
        read(a); read(b); read(c); read(d); read(a.lid)
        function f(p: Box, q: number) { read(p); read(q) }
      `)
		).toEqual(['box', 'box', 'box', undefined, 'lid', 'box', undefined]);
	});

	test('a class field read through `this`', () => {
		expect(reads(`class K { #x = box(); y = 1; go() { read(this.#x); read(this.y) } }`)).toEqual([
			'box',
			undefined
		]);
	});

	test('a shadowing name is its own', () => {
		expect(
			reads(dedent`
        const a = box()
        function f(a: number) { read(a) }
        read(a)
      `)
		).toEqual([undefined, 'box']);
	});

	test('what a tracked kind is annotated with, and what keeps it', () => {
		const report = new Report('', 'x.ts');
		const t = new Tracker<B>(parse('', report), report, [boxes]);
		expect(t.trackedType('box')).toBe('Box');
		expect(t.trackedType('lid')).toBeUndefined();
		expect(t.keeps('box', 'Box')).toBe(true);
		expect(t.keeps('box', 'Crate')).toBe(false);
	});
});

describe('the tracker and re-exports', () => {
	test('a re-export before a declaration leaves it tracked', () => {
		expect(
			reads(dedent`
        export { x } from './x.ts'
        const a = box()
        read(a)
      `)
		).toEqual(['box']);
	});
});

describe('the tracker and defaults', () => {
	test('a typed parameter with a default is tracked by its type', () => {
		expect(reads(`function f(b: Box = make()) { read(b) }`)).toEqual(['box']);
	});
});

describe('scopeAlong and annotated', () => {
	test('the scope where a path ends, and the annotated declaration of a name there', () => {
		const source = `const m: Map<string, number> = new Map()
function f(m: Set<string>, n) { read(m); read(n) }
read(m)`;
		const report = new Report(source, 'x.ts');
		const program = parse(source, report);
		const t = new Tracker<B>(program, report, [boxes]);
		t.collect();
		const found: Array<string | null> = [];
		walk(program as N, null, {
			_(node: N, { path, next }) {
				if (isCall(node, 'read')) {
					const name = node.arguments[0].name;
					const id = t.annotated(name, path);
					found.push(id === null ? null : id.typeAnnotation.typeAnnotation.typeName.name);
					expect(t.scopeAlong(path).find_owner(name)).not.toBeNull();
				}
				next();
			}
		});
		expect(found).toEqual(['Set', null, 'Map']);
	});
});

describe('fixed and untracked', () => {
	const track = (source: string) => {
		const report = new Report(source, 'x.ts');
		const program = parse(source, report);
		const t = new Tracker<B>(program, report, [boxes]);
		t.collect();
		return { t, program };
	};

	test('a literal or a name bound once and never written after is fixed', () => {
		const { t, program } = track(`import { k } from './k'
const c = 1
let l = 1
const b = box()
function f(p, q) { q = 2; read(p, q, c, l, k, f, b, 'x', 1 + 1) }`);
		const seen: Array<boolean> = [];
		walk(program as N, t.root, {
			_(node: N, { state, next }) {
				const scope = t.scopeAt(node, state);
				if (isCall(node, 'read')) for (const a of node.arguments) seen.push(t.fixed(a, scope));
				next(scope);
			}
		});
		expect(seen).toEqual([true, false, true, false, true, true, false, true, false]);
	});

	test("a function expression's own name, read inside it, is fixed: its binding never changes", () => {
		const { t, program } = track(`const g = function again(p) { read(again, p) }`);
		const seen: Array<boolean> = [];
		walk(program as N, t.root, {
			_(node: N, { state, next }) {
				const scope = t.scopeAt(node, state);
				if (isCall(node, 'read')) for (const a of node.arguments) seen.push(t.fixed(a, scope));
				next(scope);
			}
		});
		expect(seen).toEqual([true, true]);
	});

	test('a tracked value handed to a local function lands in a parameter that keeps it', () => {
		const { t, program } = track(`const b = box()
function keeps(x: Box, y) {}
function loses(x, y: Box) {}
keeps(b, b)
loses(1, b)
loses(b, 1)`);
		const found: Array<[number, string] | null> = [];
		walk(program as N, t.root, {
			_(node: N, { state, next }) {
				const scope = t.scopeAt(node, state);
				if (node.type === 'CallExpression') {
					const u = t.untracked(node, scope);
					found.push(u === null ? null : [u.index, u.want]);
				}
				next(scope);
			}
		});
		expect(found).toEqual([null, [1, 'Box'], null, [0, 'Box']]);
	});
});
