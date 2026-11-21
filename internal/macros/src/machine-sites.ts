/**
 * A `$machine` machine's call sites, compiled to its states' ints: a production build carries no
 * state names (its definitions are `compiledRunDef`'s data), so every place that names a state of
 * one writes its int there, and dev and rules builds keep the name:
 *
 *   this.#hole.go('armed')              → this.#hole.go(RULES ? 'armed' : 1)
 *   hole.move('fetching', 'retrying')   → hole.move(RULES ? 'fetching' : 2, RULES ? 'retrying' : 3)
 *   sheet.wait('loaded')                → sheet.wait(RULES ? 'loaded' : 1)
 *   this.#hole.kind === 'fetching'      → this.#hole[RULES ? 'kind' : '_k'] === (RULES ? 'fetching' : 2)
 *   switch (s.kind) { case 'live': … }  → switch (s.kind) { case (RULES ? 'live' : 3): … }
 *
 * A machine's own `kind` (not its `now`'s) is read from the field the getter reads: a compiled
 * machine's state key is its int, so a production build reads the int with no call.
 *
 * Which machine a site belongs to comes from types (./machine-types.ts). A machine's state (`kind`
 * of the machine, of its `now`, of a state's value) is read only to be compared with a state
 * written out, switched on, or kept in a `const` that is only compared or switched on: in a
 * production build it is an int. Code that runs only behind a gate (a `$rules` or `$dev`
 * function, a gated call's arguments) runs where names are kept: it is left as written.
 *
 * Refused at build: a site whose machine the types cannot name; a state named by anything but a
 * string literal (or a `?:` of them); a machine's state read for anything but a compare or a
 * switch; a state that is not one of its machine's.
 *
 * @packageDocumentation
 */
import { walk } from 'zimmerframe';
import type { N } from 'ogygia-internal-compilerkit';
import type { Scope } from 'periscopic';
import type { Compiler } from './compiler.ts';
import { GATES } from './gates.ts';
import type { MachineAt } from './machine-types.ts';

const SITE_RE = /\.\s*(?:go|move|wait|kind)\b/;

/** Whether `code` may name a machine's state at a call site (a cheap text test). */
export function may_call_machines(code: string): boolean {
	return SITE_RE.test(code);
}

/** How many of a call's first arguments name states, by method. */
const STATE_ARGS: Readonly<Record<string, number>> = { go: 1, move: 2, wait: 1 };

const COMPARES: ReadonlySet<string> = new Set(['===', '!==', '==', '!=']);

/** A machine's state kept in a `const`: where it was read, and its machine. */
interface Kept {
	readonly site: N;
	readonly machine: MachineAt;
	readonly owner: Scope;
}

/** Compiles every machine call site of `c`'s file (after the walk: the gated spans are known). */
export function compile_sites(c: Compiler): void {
	const code = c.report.code;
	if (!may_call_machines(code)) return;
	const types = c.options.types;
	const path = c.options.path;
	if (types === undefined || path === undefined) return;
	const e = c.emitter;
	const rules = GATES.get('rules')!.check(e);
	const gated = (n: N) => c.gated.some((g) => g.start <= n.start && n.end <= g.end);
	const kept = new Map<string, Kept[]>();
	const refs: Array<{ node: N; parent: N; owner: Scope | null }> = [];

	const site_of = (site: N, span: N): { of: 'run' | 'state'; machine: MachineAt } | null => {
		const at = types.site(path, code, span.start, span.end);
		if (at === null) return null;
		if ('refused' in at)
			c.report.fail(
				site,
				`the build cannot tell which machine this is (${at.refused}): a production build moves a $machine machine by its states' ints, so its type must name its definition.`
			);
		return at;
	};

	/** Writes the state `node` names (a literal, or a `?:` of them) as its int too. */
	const state = (node: N, m: MachineAt, why: N): void => {
		let n = node;
		while (n?.type === 'ParenthesizedExpression' || n?.type === 'TSAsExpression') n = n.expression;
		if (n?.type === 'ConditionalExpression') {
			state(n.consequent, m, why);
			state(n.alternate, m, why);
			return;
		}
		const name =
			n?.type === 'Literal' && typeof n.value === 'string'
				? (n.value as string)
				: n?.type === 'TemplateLiteral' && n.expressions.length === 0
					? (n.quasis[0].value.cooked as string)
					: null;
		if (name === null)
			c.report.fail(
				node ?? why,
				`a state of machine ${m.name} is written out here (a string literal, or a ?: of them): a production build writes its int in its place.`
			);
		const k = m.names.indexOf(name);
		if (k === -1)
			c.report.fail(n, `"${name}" is not a state of machine ${m.name} (${m.names.join(', ')}).`);
		e.s.overwrite(n.start, n.end, `(${rules} ? ${JSON.stringify(name)} : ${k})`);
	};

	/** Whether a state's read `value` (of machine `m`) is compared with a state written out, or
	 *  switched on: that state, or each case, is written as its int too. */
	const compared = (value: N, parent: N, m: MachineAt): boolean => {
		if (parent?.type === 'BinaryExpression' && COMPARES.has(parent.operator)) {
			state(parent.left === value ? parent.right : parent.left, m, parent);
			return true;
		}
		if (parent?.type === 'SwitchStatement' && parent.discriminant === value) {
			for (const k of parent.cases as Array<N>) if (k.test !== null) state(k.test, m, k);
			return true;
		}
		return false;
	};

	/** The node a read stands in for, past parentheses, `!` and an optional chain's wrapper. */
	const outer = (node: N, path: ReadonlyArray<N>): { node: N; parent: N; at: number } => {
		let n = node;
		let i = path.length - 1;
		while (i >= 0) {
			const p = path[i]!;
			if (
				p.type === 'ChainExpression' ||
				p.type === 'ParenthesizedExpression' ||
				p.type === 'TSNonNullExpression'
			) {
				n = p;
				i--;
				continue;
			}
			break;
		}
		return { node: n, parent: path[i] ?? null, at: i };
	};

	/** A state read (`node`, of machine `m`) where its value is used: compared, switched on, kept. */
	const read = (node: N, path: ReadonlyArray<N>, m: MachineAt, owner: Scope): void => {
		const { node: value, parent, at } = outer(node, path);
		if (compared(value, parent, m)) return;
		if (
			parent?.type === 'VariableDeclarator' &&
			parent.init === value &&
			parent.id.type === 'Identifier' &&
			path[at - 1]?.kind === 'const'
		) {
			const name = parent.id.name as string;
			const list = kept.get(name) ?? [];
			list.push({ site: node, machine: m, owner });
			kept.set(name, list);
			return;
		}
		c.report.fail(
			node,
			`machine ${m.name}'s state is read here for its value: a production build numbers its states, so a state is only compared with one written out, switched on, or kept in a const that is.`
		);
	};

	const { tracker, program } = c;
	walk(program as N, tracker.root, {
		_(n: N, ctx: { path: Array<N>; state: Scope; next: (s?: Scope) => void }) {
			const scope = tracker.scopeAt(n, ctx.state);
			if (gated(n)) return;
			const parent = ctx.path.at(-1);
			if (
				n.type === 'Identifier' &&
				parent !== undefined &&
				!(parent.type === 'MemberExpression' && parent.property === n && !parent.computed) &&
				!(parent.type === 'Property' && parent.key === n && !parent.shorthand) &&
				!(parent.type === 'VariableDeclarator' && parent.id === n)
			)
				refs.push({ node: n, parent, owner: scope.find_owner(n.name) });
			if (
				n.type === 'MemberExpression' &&
				!n.computed &&
				n.property.type === 'Identifier' &&
				n.property.name === 'kind'
			) {
				const at = site_of(n, n);
				if (at !== null) {
					read(n, ctx.path, at.machine, scope);
					if (at.of === 'run')
						e.s.overwrite(
							n.object.end,
							n.end,
							`${n.optional ? '?.' : ''}[${rules} ? "kind" : "_k"]`
						);
				}
			}
			if (
				n.type === 'CallExpression' &&
				n.callee.type === 'MemberExpression' &&
				!n.callee.computed &&
				n.callee.property.type === 'Identifier' &&
				Object.hasOwn(STATE_ARGS, n.callee.property.name)
			) {
				const at = site_of(n, n);
				if (at !== null)
					for (let i = 0; i < STATE_ARGS[n.callee.property.name as string]!; i++)
						state(n.arguments[i], at.machine, n);
			}
			ctx.next(scope);
		}
	});

	for (const { node, parent, owner } of refs) {
		const list = kept.get(node.name as string);
		const k = list?.find((x) => x.owner.find_owner(node.name) === owner);
		if (k === undefined || compared(node, parent, k.machine)) continue;
		c.report.fail(
			node,
			`${node.name} keeps machine ${k.machine.name}'s state: a production build numbers its states, so it is only compared with one written out or switched on.`
		);
	}
}
