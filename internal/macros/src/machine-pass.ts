/**
 * `$machine<S>()({ name, initial, steps, after })`: a machine definition, read and checked at build.
 *
 * The build reads the definition (its steps written in place, or a module const of an object
 * literal, `as const` or not), refuses what `runDef` would refuse at runtime, and writes:
 *
 *   RULES ? runDef({ …as written… }) : compiledRunDef('hole', ['idle', 'armed', …], 0, [6, 5, …], [timeouts])
 *
 * so a production build carries the definition as data (its states' names, its initial state's
 * int, each state's steps as bitmasks, its timeouts) and none of `runDef`'s reading or checks, while
 * dev and rules builds (tests, e2e, the simulator) keep `runDef` itself: its checks, `graph()` and
 * `paths()`, and the moves its observers hear, as before.
 *
 * Refused at build: a call that is not `$machine<S>()({ … })` with one object literal; a `name` or
 * `initial` that is not a string literal; steps that are not an object literal of arrays of string
 * literals; a step to a state that is not one, written twice, or a state no step reaches from
 * `initial`; a timeout of a state that is not one, whose `to` is not one of its steps, or whose `ms`
 * the build reads (a number written there, or a module const of one) is not a time a timer holds.
 *
 * @packageDocumentation
 */
import { code, type N, type Pass, type Visit } from 'ogygia-internal-compilerkit';
import type { Scope } from 'periscopic';
import type { Compiler } from './compiler.ts';
import { GATES } from './gates.ts';

/** Where the runtime the output calls lives. */
export const MACHINE_RUNTIME = '@ogygia/machine';

/** The longest delay a timer holds (2^31 - 1 ms). */
const MAX_TIMEOUT_MS = 2_147_483_647;

const SHAPE =
	'$machine<S>()({ name, initial, steps, after }) is one expression: the states’ data as its type, then one object literal.';

/** A definition as the build read it. */
export interface ReadMachine {
	readonly name: string;
	readonly names: readonly string[];
	readonly initial: number;
	/** Each state's steps, `words` 32-bit words per state (`runDef`'s layout). */
	readonly masks: readonly number[];
	/** Each timeout: its state, its ms and data as written (data `null`: none), its `to`. */
	readonly timed: ReadonlyArray<{ state: number; ms: N; to: number; data: N }>;
}

/** The `$machine` pass. */
export class MachinePass implements Pass<Scope> {
	readonly #c: Compiler;

	constructor(c: Compiler) {
		this.#c = c;
	}

	call(node: N, _v: Visit<Scope>): boolean {
		const c = this.#c;
		const inner = node.callee;
		if (node.callee?.type === 'Identifier' && node.callee.name === '$machine')
			c.report.fail(node, SHAPE);
		if (inner?.type !== 'CallExpression' || inner.callee?.type !== 'Identifier') return false;
		if (inner.callee.name !== '$machine') return false;
		if (inner.arguments.length !== 0 || node.arguments.length !== 1) c.report.fail(node, SHAPE);
		const config = node.arguments[0];
		if (config.type !== 'ObjectExpression') c.report.fail(config, SHAPE);
		const read = read_machine(this.#c, config);
		const e = this.#c.emitter;
		const define = e.imported(MACHINE_RUNTIME, 'runDef');
		const compiled = e.imported(MACHINE_RUNTIME, 'compiledRunDef');
		const rules = GATES.get('rules')!.check(e);
		const timed = read.timed.map(
			(t) => `[${t.state}, ${e.text(t.ms)}, ${t.to}${t.data === null ? '' : `, ${e.text(t.data)}`}]`
		);
		const data = `${JSON.stringify(read.name)}, ${JSON.stringify(read.names)}, ${read.initial}, [${read.masks.join(', ')}]${timed.length === 0 ? '' : `, [${timed.join(', ')}]`}`;
		e.rewrite(node, code`(${rules} ? ${define}(${config}) : ${compiled}(${data}))`);
		return true;
	}
}

const key_of = (p: N): string | null =>
	p.type !== 'Property' || p.computed
		? null
		: p.key.type === 'Identifier'
			? (p.key.name as string)
			: typeof p.key.value === 'string'
				? (p.key.value as string)
				: null;

/** The object literal `node` is, or names: a module const (`as const` or `satisfies` too). */
function object_of(c: Compiler, node: N): N {
	let n = node;
	while (n?.type === 'TSAsExpression' || n?.type === 'TSSatisfiesExpression') n = n.expression;
	if (n?.type === 'ObjectExpression') return n;
	if (n?.type !== 'Identifier') return null;
	const init = module_const(c, n.name as string);
	return init === null ? null : object_of(c, init);
}

/** The initializer of the module's own `const <name> = …`, or null. */
function module_const(c: Compiler, name: string): N {
	for (const statement of c.program.body as Array<N>) {
		const decl = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
		if (decl?.type !== 'VariableDeclaration' || decl.kind !== 'const') continue;
		for (const d of decl.declarations as Array<N>)
			if (d.id.type === 'Identifier' && d.id.name === name) return d.init ?? null;
	}
	return null;
}

/** A number the node is: a literal, `-literal`, or a module const of one. */
function number_of(c: Compiler, node: N): number | null {
	let n = node;
	while (n?.type === 'TSAsExpression' || n?.type === 'TSSatisfiesExpression') n = n.expression;
	if (n?.type === 'Literal' && typeof n.value === 'number') return n.value as number;
	if (n?.type === 'UnaryExpression' && n.operator === '-') {
		const inner = number_of(c, n.argument);
		return inner === null ? null : -inner;
	}
	if (n?.type === 'Identifier') {
		const init = module_const(c, n.name as string);
		return init === null ? null : number_of(c, init);
	}
	return null;
}

const string_of = (node: N): string | null =>
	node?.type === 'Literal' && typeof node.value === 'string' ? (node.value as string) : null;

/** Reads and checks the definition `config` (an object literal), as `runDef` and its dev checks
 *  would at runtime. */
export function read_machine(c: Compiler, config: N): ReadMachine {
	const props = new Map<string, N>();
	for (const p of config.properties as Array<N>) {
		const key = key_of(p);
		if (key === null)
			c.report.fail(p, `${SHAPE} Its keys are written out: no spread, no computed key.`);
		props.set(key, p.value);
	}
	for (const key of props.keys())
		if (key !== 'name' && key !== 'initial' && key !== 'steps' && key !== 'after')
			c.report.fail(
				props.get(key)!,
				`a machine's definition has name, initial, steps and after: not ${key}.`
			);
	const name = string_of(props.get('name')!);
	if (name === null)
		c.report.fail(props.get('name') ?? config, 'a machine’s name is a string literal.');
	const steps_node = props.get('steps');
	const steps = steps_node === undefined ? null : object_of(c, steps_node);
	if (steps === null)
		c.report.fail(
			steps_node ?? config,
			`machine ${name}: its steps are an object literal (written here, or a const of this module).`
		);
	const names: string[] = [];
	const lists: string[][] = [];
	for (const p of steps.properties as Array<N>) {
		const key = key_of(p);
		if (key === null) c.report.fail(p, `machine ${name}: each state of its steps is written out.`);
		let list = p.value;
		while (list?.type === 'TSAsExpression') list = list.expression;
		if (list?.type !== 'ArrayExpression')
			c.report.fail(p.value, `machine ${name}: the steps of "${key}" are an array of state names.`);
		const tos: string[] = [];
		for (const el of list.elements as Array<N>) {
			const to = string_of(el);
			if (to === null)
				c.report.fail(el ?? list, `machine ${name}: a step of "${key}" is a string literal.`);
			if (tos.includes(to))
				c.report.fail(el, `machine ${name}: "${key}" lists "${to}" twice in its steps.`);
			tos.push(to);
		}
		names.push(key);
		lists.push(tos);
	}
	const ids = new Map(names.map((k, i) => [k, i]));
	const initial_name = string_of(props.get('initial')!);
	if (initial_name === null)
		c.report.fail(
			props.get('initial') ?? config,
			`machine ${name}: its initial state is a string literal.`
		);
	const initial = ids.get(initial_name);
	if (initial === undefined)
		c.report.fail(
			props.get('initial')!,
			`machine ${name}: its initial state "${initial_name}" is not one of its states.`
		);
	const words = (names.length + 31) >>> 5;
	const masks = Array.from({ length: names.length * words }, () => 0);
	for (let from = 0; from < names.length; from++)
		for (const to of lists[from]!) {
			const t = ids.get(to);
			if (t === undefined)
				c.report.fail(
					steps,
					`machine ${name}: "${to}", a step of "${names[from]}", is not one of its states.`
				);
			masks[from * words + (t >>> 5)] = masks[from * words + (t >>> 5)]! | (1 << (t & 31)) | 0;
		}
	// every state reached from the initial one (one that no step reaches could never be entered)
	const seen = new Set([initial]);
	const queue = [initial];
	while (queue.length > 0) {
		const at = queue.pop()!;
		for (const to of lists[at]!) {
			const t = ids.get(to)!;
			if (!seen.has(t)) {
				seen.add(t);
				queue.push(t);
			}
		}
	}
	for (let k = 0; k < names.length; k++)
		if (!seen.has(k))
			c.report.fail(
				steps,
				`machine ${name}: state "${names[k]}" can never be reached from "${initial_name}".`
			);
	const timed: Array<{ state: number; ms: N; to: number; data: N }> = [];
	const after_node = props.get('after');
	if (after_node !== undefined) {
		const after = object_of(c, after_node);
		if (after === null)
			c.report.fail(after_node, `machine ${name}: its timeouts are an object literal.`);
		for (const p of after.properties as Array<N>) {
			const state = key_of(p);
			if (state === null) c.report.fail(p, `machine ${name}: each timeout's state is written out.`);
			const k = ids.get(state);
			if (k === undefined)
				c.report.fail(
					p,
					`machine ${name}: "${state}", a state with a timeout, is not one of its states.`
				);
			const t = object_of(c, p.value);
			if (t === null)
				c.report.fail(p.value, `machine ${name}: the timeout of "${state}" is an object literal.`);
			const parts = new Map<string, N>();
			for (const q of t.properties as Array<N>) {
				const key = key_of(q);
				if (key === null || (key !== 'ms' && key !== 'to' && key !== 'data'))
					c.report.fail(q, `machine ${name}: a timeout has ms, to and data.`);
				parts.set(key, q.value);
			}
			const to_name = string_of(parts.get('to')!);
			const to = to_name === null ? undefined : ids.get(to_name);
			if (to === undefined || !lists[k]!.includes(to_name!))
				c.report.fail(
					parts.get('to') ?? t,
					`machine ${name}: the timeout of "${state}": "${to_name}" is not one of its steps.`
				);
			const ms = parts.get('ms');
			if (ms === undefined)
				c.report.fail(t, `machine ${name}: the timeout of "${state}" has its ms.`);
			const fn = ms.type === 'ArrowFunctionExpression' || ms.type === 'FunctionExpression';
			const n = fn ? null : number_of(c, ms);
			// (an ms the build cannot read, a const of another module, is checked where the time is
			// armed, and by runDef in dev and rules builds)
			if (!fn && n !== null && (!Number.isFinite(n) || n < 0 || n > MAX_TIMEOUT_MS))
				c.report.fail(
					ms,
					`machine ${name}: the timeout of "${state}": its ms (${n}) is not a time of 0 to ${MAX_TIMEOUT_MS} (a timer holds no more).`
				);
			timed.push({ state: k, ms, to, data: parts.get('data') ?? null });
		}
	}
	return { name, names, initial, masks, timed };
}
