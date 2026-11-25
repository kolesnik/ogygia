/**
 * Machine primitives, for a compiler that turns a state machine's definition into numbers at
 * build time. They decide nothing about a machine's API: a consumer's own `$machine` macro is
 * built from them.
 *
 * - `enumerate(names)`: a closed set of names → numbers, in order.
 * - `transitions(states, events, f)`: the dense state × event table, `-1` where a pair is refused.
 * - `bitsets(states, groups)`: each group of states as one bitmask.
 * - `exhaustive(table)`: the pairs neither handled nor refused (a build error for each).
 * - `reachable(table, start)`: which states some path from `start` reaches, and the dead ones.
 *
 * @packageDocumentation
 */

/** A closed set of names, numbered in order. */
export interface Enumerated<S extends string = string> {
	readonly names: ReadonlyArray<S>;
	readonly size: number;
	/** The number of `name`. */
	of(name: S): number;
}

/** Numbers `names` in order: the first is 0. A name given twice is an error. */
export function enumerate<const S extends string>(names: ReadonlyArray<S>): Enumerated<S> {
	const index = new Map<S, number>();
	names.forEach((name, i) => {
		if (index.has(name)) throw new Error(`enumerate: "${name}" is named twice.`);
		index.set(name, i);
	});
	return Object.freeze({
		names: Object.freeze([...names]),
		size: names.length,
		of(name: S): number {
			const i = index.get(name);
			if (i === undefined) throw new Error(`enumerate: no "${name}".`);
			return i;
		}
	});
}

/** What a transition gives for one state and event: the next state, refused (`null`), or not
 *  decided (`undefined`, which `exhaustive` reports). */
export type Next<S extends string> = S | null | undefined;

/** The dense table: `rows[state][event]` is the next state's number, `-1` refused, `-2` not
 *  decided. */
export interface Transitions<S extends string = string, E extends string = string> {
	readonly states: Enumerated<S>;
	readonly events: Enumerated<E>;
	readonly rows: ReadonlyArray<ReadonlyArray<number>>;
}

/** The refused pair's entry. */
export const REFUSED = -1;
/** The undecided pair's entry. */
export const UNDECIDED = -2;

/** The table of `f` over every state and event. */
export function transitions<S extends string, E extends string>(
	states: Enumerated<S>,
	events: Enumerated<E>,
	f: (state: S, event: E) => Next<S>
): Transitions<S, E> {
	const rows = states.names.map((state) =>
		events.names.map((event) => {
			const next = f(state, event);
			if (next === undefined) return UNDECIDED;
			return next === null ? REFUSED : states.of(next);
		})
	);
	return Object.freeze({ states, events, rows });
}

/** Each group (a list of state names) as one bitmask over the states' numbers (at most 31). */
export function bitsets<S extends string>(
	states: Enumerated<S>,
	groups: ReadonlyArray<ReadonlyArray<S>>
): Array<number> {
	if (states.size > 31) throw new Error(`bitsets: ${states.size} states; a mask holds 31.`);
	return groups.map((group) => group.reduce((mask, name) => mask | (1 << states.of(name)), 0));
}

/** The pairs neither handled nor refused: `[state, event]` each, in table order. */
export function exhaustive<S extends string, E extends string>(
	table: Transitions<S, E>
): Array<readonly [S, E]> {
	const out: Array<readonly [S, E]> = [];
	table.rows.forEach((row, s) =>
		row.forEach((next, e) => {
			if (next === UNDECIDED) out.push([table.states.names[s]!, table.events.names[e]!]);
		})
	);
	return out;
}

/** The states some path from `start` reaches, and the dead ones (by name, in order). */
export function reachable<S extends string, E extends string>(
	table: Transitions<S, E>,
	start: S
): { readonly reached: ReadonlySet<number>; readonly dead: ReadonlyArray<S> } {
	const reached = new Set<number>([table.states.of(start)]);
	const queue = [...reached];
	while (queue.length !== 0) {
		const s = queue.shift()!;
		for (const next of table.rows[s]!)
			if (next >= 0 && !reached.has(next)) {
				reached.add(next);
				queue.push(next);
			}
	}
	return {
		reached,
		dead: table.states.names.filter((_, i) => !reached.has(i))
	};
}
