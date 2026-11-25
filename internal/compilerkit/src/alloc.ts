/**
 * Could this function allocate? A syntactic answer, for code that runs per frame or per input
 * event and must make no garbage. It names every place that may allocate: an object or array
 * literal, a closure or class, a template literal or string concatenation, `new`, a spread or a
 * rest, a regular expression, an iterator (`for…of`, `for…in`, array destructuring), `await` or
 * `yield`. A call is the consumer's to judge (`call`): a callee known not to allocate, or why it
 * may. A subtree the consumer marks as an explicit exception (`skip`) is not read.
 *
 * @packageDocumentation
 */
import { walk } from 'zimmerframe';
import type { N } from './ast.ts';

/** A place that may allocate, and what it is. */
export interface Allocation {
	readonly node: N;
	readonly what: string;
}

/** How calls and exceptions are judged. */
export interface AllocationRules {
	/** A call (or `new`-free optional call): null when the callee is known not to allocate, or
	 *  why it may. `path` holds the call's ancestors, outermost first. */
	readonly call: (node: N, path: ReadonlyArray<N>) => string | null;
	/** A node not read here: an explicit, named exception, or a part the consumer reads itself.
	 *  `path` holds its ancestors, outermost first. */
	readonly skip?: (node: N, path: ReadonlyArray<N>) => boolean;
	/** A `for…of` the consumer compiles to an index loop: no iterator, its pattern no
	 *  destructuring; its list and body are read. */
	readonly indexLoop?: (node: N) => boolean;
}

const isString = (n: N): boolean =>
	(n?.type === 'Literal' && typeof n.value === 'string') || n?.type === 'TemplateLiteral';

/** Every place in function `fn` that may allocate. */
export function allocations(fn: N, rules: AllocationRules): Array<Allocation> {
	const out: Array<Allocation> = [];
	const say = (node: N, what: string) => out.push({ node, what });
	if (fn.async === true) say(fn, 'an async function (a promise per call)');
	if (fn.generator === true) say(fn, 'a generator (an iterator per call)');
	for (const p of fn.params ?? []) if (p.type === 'RestElement') say(p, 'a rest parameter');
	const looped = new Set<N>();
	walk(fn.body as N, null, {
		_(node: N, { path, next }) {
			if (rules.skip?.(node, path) === true) return;
			if (looped.has(node)) return;
			switch (node.type) {
				case 'ObjectExpression':
					say(node, 'an object literal');
					break;
				case 'ArrayExpression':
					say(node, 'an array literal');
					break;
				case 'ArrowFunctionExpression':
				case 'FunctionExpression':
					say(node, 'a closure');
					return;
				case 'ClassExpression':
					say(node, 'a class');
					return;
				case 'TemplateLiteral':
					say(node, 'a template literal');
					break;
				case 'TaggedTemplateExpression':
					say(node, 'a tagged template');
					break;
				case 'NewExpression':
					say(node, '`new`');
					break;
				case 'SpreadElement':
					say(node, 'a spread');
					break;
				case 'RestElement':
					say(node, 'a rest element');
					break;
				case 'ArrayPattern':
					say(node, 'array destructuring (an iterator)');
					break;
				case 'ForOfStatement':
					if (rules.indexLoop?.(node) === true) {
						looped.add(node.left);
						break;
					}
					say(node, '`for…of` (an iterator)');
					break;
				case 'ForInStatement':
					say(node, '`for…in` (an iterator)');
					break;
				case 'AwaitExpression':
					say(node, '`await`');
					break;
				case 'YieldExpression':
					say(node, '`yield`');
					break;
				case 'Literal':
					if (node.regex !== undefined) say(node, 'a regular expression');
					break;
				case 'BinaryExpression':
					if (node.operator === '+' && (isString(node.left) || isString(node.right)))
						say(node, 'string concatenation');
					break;
				case 'AssignmentExpression':
					if (node.operator === '+=' && isString(node.right)) say(node, 'string concatenation');
					break;
				case 'CallExpression': {
					const why = rules.call(node, path);
					if (why !== null) say(node, why);
					break;
				}
			}
			next();
		}
	});
	return out;
}

/** Globals whose calls make nothing: every method of one (`true`), or the methods named. */
export const PURE_CALLS: Readonly<Record<string, ReadonlySet<string> | true>> = {
	Math: true,
	Number: new Set(['isFinite', 'isNaN', 'isInteger', 'isSafeInteger']),
	Array: new Set(['isArray']),
	Object: new Set(['is', 'hasOwn'])
};

/** Global functions that make nothing. */
export const PURE_FUNCTIONS: ReadonlySet<string> = new Set(['isFinite', 'isNaN']);

/** The built-in classes' lookups: methods that make nothing, on a receiver declared with that
 *  class. */
export const LOOKUPS: Readonly<Record<string, ReadonlySet<string>>> = {
	Map: new Set(['get', 'has']),
	WeakMap: new Set(['get', 'has']),
	Set: new Set(['has']),
	WeakSet: new Set(['has'])
};

/**
 * Whether a call surely makes nothing by what the language promises: a pure global
 * (`PURE_FUNCTIONS`, `PURE_CALLS`), or a lookup (`LOOKUPS`) on a receiver `classOf` says is
 * declared with that class.
 */
export function pureCall(call: N, classOf: (receiver: N) => string | null): boolean {
	const callee = call.callee;
	if (callee.type === 'Identifier') return PURE_FUNCTIONS.has(callee.name);
	if (
		callee.type !== 'MemberExpression' ||
		callee.computed ||
		callee.property.type !== 'Identifier'
	)
		return false;
	const method: string = callee.property.name;
	const object = callee.object;
	if (object.type === 'Identifier') {
		const pure = Object.hasOwn(PURE_CALLS, object.name) ? PURE_CALLS[object.name] : undefined;
		if (pure === true || pure?.has(method) === true) return true;
	}
	const cls = classOf(object);
	return cls !== null && Object.hasOwn(LOOKUPS, cls) && LOOKUPS[cls]!.has(method);
}
