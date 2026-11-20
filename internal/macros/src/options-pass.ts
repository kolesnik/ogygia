/**
 * Option bags checked at build. A call of `flights`, `flights.keyed<I>()`, `cache`, `queue`, `say`
 * or `policy` imported from `@ogygia/machine` (or `plain_flights`, `pass_queue`, `plain_queue` or
 * `lru` from `@ogygia/machine/internal`) whose options the build can read is checked here by the
 * machine's own
 * checks (`check_*` of `@ogygia/machine/internal`, the ones the public makers run), so a bad option
 * fails the build with the code it would throw at runtime (`machine_bad_option`). The call then
 * makes its value without checking again:
 *
 *   flights({ name: 'x', run })        →  trusted_flights({ name: 'x', run })
 *   policy({ attempts: 2, backoff: 0 }) →  the policy itself, as frozen data
 *
 * so production ships no option checks for ogygia's own calls. The build reads literals, a module's
 * own consts of them, and functions (as functions); anything else (a value only the runtime has) is
 * fine where the checks never read it. A call whose checks read a value the build cannot know keeps
 * the runtime check (and the build says so).
 *
 * @packageDocumentation
 */
import { code, parseSync, type N, type Pass, type Visit } from 'ogygia-internal-compilerkit';
import { fileCache, relativeImports } from 'ogygia-internal-compilerkit/modules';
import type { Scope } from 'periscopic';
import { policy, MachineError, type Policy } from '@ogygia/machine';
import {
	check_cache,
	check_flights,
	check_plain_flights,
	check_plain_queue,
	check_queue,
	check_say
} from '@ogygia/machine/internal';
import type { Compiler } from './compiler.ts';

/** Where the unchecked makers live. */
export const TRUSTED_RUNTIME = '@ogygia/machine/internal';

/** The makers whose options the build checks, by their name in `@ogygia/machine`. */
const MAKERS: ReadonlyMap<string, { check: (o: never) => void; trusted: string | null }> = new Map<
	string,
	{ check: (o: never) => void; trusted: string | null }
>([
	['flights', { check: (o: never) => check_flights(o), trusted: 'trusted_flights' }],
	['flights.keyed', { check: (o: never) => check_flights(o, true), trusted: 'trusted_flights' }],
	['cache', { check: (o: never) => check_cache(o), trusted: 'trusted_cache' }],
	['queue', { check: (o: never) => check_queue(o), trusted: 'trusted_queue' }],
	['say', { check: (o: never) => check_say(o), trusted: 'trusted_say' }],
	['policy', { check: (o: never) => void policy(o), trusted: null }],
	// the runtime's lean makers (`@ogygia/machine/internal`): the same checks, the lean trusted maker
	[
		'plain_flights',
		{ check: (o: never) => check_plain_flights(o), trusted: 'trusted_plain_flights' }
	],
	[
		'plain_flights.keyed',
		{ check: (o: never) => check_plain_flights(o, true), trusted: 'trusted_plain_flights' }
	],
	['pass_queue', { check: (o: never) => check_queue(o), trusted: 'trusted_pass_queue' }],
	['plain_queue', { check: (o: never) => check_plain_queue(o), trusted: 'trusted_plain_queue' }],
	['lru', { check: (o: never) => check_cache(o), trusted: 'trusted_lru' }]
]);

/** The makers of `@ogygia/machine/internal` the build checks (the rest of MAKERS are
 *  `@ogygia/machine`'s). */
const INTERNAL_MAKERS: ReadonlySet<string> = new Set([
	'plain_flights',
	'pass_queue',
	'plain_queue',
	'lru'
]);

/** Options whose check is their type alone (a function; a policy): one the build cannot read takes
 *  this stand-in, since ogygia's own source, which this pass compiles, is type-checked. */
const TYPED: ReadonlyMap<string, unknown> = new Map<string, unknown>([
	['run', () => {}],
	['weigh', () => {}],
	['touches', () => {}],
	['retry', policy.standard]
]);

/** Whether `code` may call a maker the build checks (so the file is compiled). */
export function calls_makers(code: string): boolean {
	return (
		(code.includes("'@ogygia/machine'") && /\b(?:flights|cache|queue|say|policy)\b/.test(code)) ||
		(code.includes("'@ogygia/machine/internal'") &&
			/\b(?:plain_flights|pass_queue|plain_queue|lru)\b/.test(code))
	);
}

const UNKNOWN: unique symbol = Symbol('unknown');

/** A check read a value only the runtime has. */
class Unread extends Error {
	readonly what: string;
	constructor(what: string) {
		super(what);
		this.what = what;
	}
}

/** The options pass. */
export class OptionsPass implements Pass<Scope> {
	readonly #c: Compiler;
	/** Local name → its name in `@ogygia/machine`, for the makers this file imports. */
	readonly #imports = new Map<string, string>();

	constructor(c: Compiler) {
		this.#c = c;
	}

	prepare(): void {
		for (const statement of this.#c.program.body as Array<N>) {
			if (statement.type !== 'ImportDeclaration' || statement.importKind === 'type') continue;
			const from = statement.source.value;
			if (from !== '@ogygia/machine' && from !== TRUSTED_RUNTIME) continue;
			for (const s of statement.specifiers as Array<N>) {
				if (s.type !== 'ImportSpecifier' || s.importKind === 'type') continue;
				const name = s.imported.name ?? s.imported.value;
				if (MAKERS.has(name) && INTERNAL_MAKERS.has(name) === (from === TRUSTED_RUNTIME))
					this.#imports.set(s.local.name, name);
			}
		}
	}

	call(node: N, v: Visit<Scope>): boolean {
		const name = this.#maker(node, v.scope);
		if (name === null) return false;
		const c = this.#c;
		const maker = MAKERS.get(name)!;
		const arg = node.arguments[0];
		const here: Mod = { program: c.program, path: c.options.path ?? null };
		const options = arg === undefined ? {} : read(here, arg);
		const readable = options !== UNKNOWN;
		let unread: string | null = readable ? null : 'its options';
		if (readable) {
			try {
				maker.check(options as never);
			} catch (e) {
				if (e instanceof Unread) unread = e.what;
				else if (e instanceof MachineError)
					c.report.fail(node, `${e.code}: ${e.message} (checked at build)`);
				else throw e;
			}
		}
		if (unread !== null) {
			c.report.warn(node, `${name}(…) keeps its runtime check: the build cannot read ${unread}.`);
			return false;
		}
		const e = c.emitter;
		if (name === 'policy') {
			e.rewrite(node, code`${policy_data(policy(options as Partial<Policy>))}`);
			return true;
		}
		e.rewrite(node.callee, code`${e.imported(TRUSTED_RUNTIME, maker.trusted!)}`);
		v.next();
		return true;
	}

	/** The maker `node` calls, or null. */
	#maker(node: N, scope: Scope): string | null {
		const callee = node.callee;
		const top = this.#c.tracker.root;
		if (callee?.type === 'Identifier') {
			const name = this.#imports.get(callee.name);
			if (name === undefined || scope.find_owner(callee.name) !== top) return null;
			return name;
		}
		if (callee?.type !== 'CallExpression' || callee.arguments.length !== 0) return null;
		const keyed = callee.callee;
		if (keyed?.type !== 'MemberExpression' || keyed.computed || keyed.property.name !== 'keyed')
			return null;
		const of = keyed.object;
		if (of?.type === 'Identifier') {
			const maker = this.#imports.get(of.name);
			if ((maker !== 'flights' && maker !== 'plain_flights') || scope.find_owner(of.name) !== top)
				return null;
			return `${maker}.keyed`;
		}
		return null;
	}
}

const num = (n: number): string => (n === Infinity ? 'Infinity' : String(n));

/** A checked policy as the frozen data `policy()` makes. */
function policy_data(p: Policy): string {
	const backoff =
		typeof p.backoff === 'number'
			? num(p.backoff)
			: `/* @__PURE__ */ Object.freeze([${p.backoff.map(num).join(', ')}])`;
	return `/* @__PURE__ */ Object.freeze({ attempts: ${num(p.attempts)}, backoff: ${backoff}, jitter: ${num(p.jitter)}, deadline: ${num(p.deadline)} })`;
}

/** A module the build reads values in: its tree, and where it is (null: no file, so no imports). */
interface Mod {
	readonly program: N;
	readonly path: string | null;
}

const module_at: (file: string) => Mod | null = fileCache((path, source) => ({
	program: parseSync(path, source, { lang: 'ts', sourceType: 'module' }).program,
	path
}));

function strip(node: N): N {
	let n = node;
	while (
		n?.type === 'TSAsExpression' ||
		n?.type === 'TSSatisfiesExpression' ||
		n?.type === 'TSNonNullExpression' ||
		n?.type === 'ParenthesizedExpression'
	)
		n = n.expression;
	return n;
}

/** The value `name` names at `mod`'s top (its own const or function, or one it imports from a
 *  module of the build), read; UNKNOWN when the build cannot read it. */
function named(mod: Mod, name: string, depth: number): unknown {
	for (const statement of mod.program.body as Array<N>) {
		const decl = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
		if (decl?.type === 'FunctionDeclaration' && decl.id?.name === name) return FUNCTION;
		if (decl?.type !== 'VariableDeclaration' || decl.kind !== 'const') continue;
		for (const d of decl.declarations as Array<N>)
			if (d.id.type === 'Identifier' && d.id.name === name)
				return d.init == null ? UNKNOWN : read(mod, d.init, depth + 1);
	}
	if (mod.path === null) return UNKNOWN;
	const from = relativeImports(mod.path, mod.program, { values: true }).get(name);
	const other = from === undefined ? null : module_at(from.from);
	return other === null || from === undefined ? UNKNOWN : named(other, from.name, depth + 1);
}

/** Whether `mod` imports `local` as `name` from `@ogygia/machine`. */
function machine_import(mod: Mod, local: string, name: string): boolean {
	for (const statement of mod.program.body as Array<N>) {
		if (statement.type !== 'ImportDeclaration' || statement.source.value !== '@ogygia/machine')
			continue;
		for (const s of statement.specifiers as Array<N>)
			if (s.type === 'ImportSpecifier' && s.local.name === local)
				return (s.imported.name ?? s.imported.value) === name;
	}
	return false;
}

const FUNCTION = (): void => {};

/** What the build knows of `node`'s value in `mod`: the value, a view that refuses a read of what
 *  it does not know (an object or a list), or UNKNOWN. A `policy({ … })` it reads is the policy. */
function read(mod: Mod, node: N, depth = 0): unknown {
	const n = strip(node);
	if (depth > 8 || n == null) return UNKNOWN;
	switch (n.type) {
		case 'Literal':
			return n.regex || n.bigint !== undefined ? UNKNOWN : n.value;
		case 'TemplateLiteral':
			return n.expressions.length === 0 ? n.quasis[0].value.cooked : UNKNOWN;
		case 'ArrowFunctionExpression':
		case 'FunctionExpression':
			return FUNCTION;
		case 'UnaryExpression': {
			const v = read(mod, n.argument, depth + 1);
			if (typeof v !== 'number') return UNKNOWN;
			return n.operator === '-' ? -v : n.operator === '+' ? v : UNKNOWN;
		}
		case 'BinaryExpression': {
			const a = read(mod, n.left, depth + 1);
			const b = read(mod, n.right, depth + 1);
			if (typeof a !== 'number' || typeof b !== 'number') return UNKNOWN;
			if (n.operator === '*') return a * b;
			if (n.operator === '+') return a + b;
			if (n.operator === '-') return a - b;
			if (n.operator === '/') return a / b;
			return UNKNOWN;
		}
		case 'Identifier':
			if (n.name === 'undefined') return undefined;
			if (n.name === 'Infinity') return Infinity;
			return named(mod, n.name, depth);
		case 'CallExpression': {
			const callee = n.callee;
			if (callee?.type !== 'Identifier' || !machine_import(mod, callee.name, 'policy'))
				return UNKNOWN;
			const p = n.arguments.length === 0 ? {} : read(mod, n.arguments[0], depth + 1);
			if (p === UNKNOWN) return UNKNOWN;
			try {
				return policy(p as Partial<Policy>);
			} catch {
				// oxlint-disable-next-line ogygia/no-silent-failures -- a policy that does not check is not read here: its own call fails the build where it is written
				return UNKNOWN;
			}
		}
		case 'ArrayExpression': {
			const elements = n.elements as Array<N>;
			if (elements.some((el) => el?.type === 'SpreadElement')) return UNKNOWN;
			return view(
				elements.map((el) => (el === null ? UNKNOWN : read(mod, el, depth + 1))),
				'a list item'
			);
		}
		case 'ObjectExpression': {
			const target: Record<string, unknown> = {};
			for (const p of n.properties as Array<N>) {
				if (p.type !== 'Property' || p.computed) return UNKNOWN;
				const key = p.key.type === 'Identifier' ? p.key.name : p.key.value;
				if (typeof key !== 'string') return UNKNOWN;
				const value = p.method ? FUNCTION : read(mod, p.value, depth + 1);
				target[key] = value === UNKNOWN && TYPED.has(key) ? TYPED.get(key) : value;
			}
			return view(target, 'option');
		}
		default:
			return UNKNOWN;
	}
}

/** `target`, as a view whose read of an UNKNOWN throws Unread. */
function view<T extends object>(target: T, what: string): T {
	return new Proxy(target, {
		get(t, key, receiver) {
			const v = Reflect.get(t, key, receiver);
			if (v === UNKNOWN) throw new Unread(`${what} ${String(key)}`);
			return v;
		}
	});
}
