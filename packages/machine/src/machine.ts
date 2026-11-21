/**
 * One state value in place of a pile of flags.
 *
 *   const hole = machine<{ idle: {}; fetching: { attempt: number }; failed: { error: unknown } }>()({
 *     name: 'hole',
 *     initial: 'idle',
 *     steps: { idle: ['fetching'], fetching: ['idle', 'failed'], failed: ['fetching'] }
 *   });
 *   const h = hole.create();
 *   h.go('fetching', { attempt: 1 });
 *
 * A machine is in exactly one state at a time, and a state can only go where its `steps` say. Every
 * move goes through one place, which is what makes the rest possible: each visit to a state is a
 * scope (`m.scope`, ./scope.ts), so work started in it (`m.scope.task`) is aborted and its answer
 * dropped once the machine leaves, and what it holds (listeners, timers, observers, cleanups) is
 * released exactly once when it leaves; and a `wait()` for a state that can no longer be reached
 * settles at once instead of hanging.
 *
 * Speed: a machine is the plain runtime record of ./run.ts (its state an int, each state's steps a
 * bitmask): a move tests one bit and makes no object. The state as one value (`now`) is made when
 * something reads it, once per visit, and a visit's scope and the waiter list are made the first
 * time they are needed: a move nothing hangs work on makes none of them.
 */
import { machine_error, warn_once } from './messages.ts';
import { noop } from './noop.ts';
import { define as define_run, heard, made, Named, RULES, watch_moves, type Def } from './run.ts';
import { CLOSED, SCOPED, type Scope } from './scope.ts';
import { STALE, type Stale } from './stale.ts';

export { STALE, type Stale };

/** The data each state carries, by state name: `{ idle: {}; failed: { error: unknown } }`. A
 *  state's data cannot have a `kind` field: that is the state's name. */
export type Shape<S> = { [K in keyof S]: object & { kind?: never } };

/** A state name of `S`. */
export type Kind<S> = keyof S & string;

/** The machine's state: one value, `kind` plus that state's data. Narrows on `kind`. */
export type StateOf<S> = { [K in Kind<S>]: Readonly<{ kind: K } & S[K]> }[Kind<S>];

/** Where each state can go next. A final state has an empty list. */
export type Steps<S> = { readonly [K in Kind<S>]: readonly Kind<S>[] };

/** The data argument of a move to a state with data `D`: none for a state with no data, optional
 *  when all of it is optional, required otherwise. */
export type DataArgs<D> = [keyof D] extends [never] ? [] : {} extends D ? [data?: D] : [data: D];

/** The steps written in the definition: every state, and nothing else. */
type ExactSteps<S, T> = T & { readonly [K in Exclude<keyof T, keyof S>]: never };

/** The value of state `K`. */
export type StateIn<S, K extends Kind<S>> = Extract<StateOf<S>, { kind: K }>;

/**
 * How long state `K` lasts on its own, and the step it then takes: one of its own steps, with that
 * state's data made from the state it leaves (required exactly when the target has data).
 */
export type Timeout<S extends Shape<S>, T extends Steps<S>, K extends Kind<S>> = {
	[To in T[K][number] & Kind<S>]: {
		/** Milliseconds in the state before the step (0 or more), or made from the state's value. */
		readonly ms: number | ((now: StateIn<S, K>) => number);
		readonly to: To;
	} & ([keyof S[To]] extends [never]
		? { readonly data?: never }
		: {} extends S[To]
			? { readonly data?: (now: StateIn<S, K>) => S[To] }
			: { readonly data: (now: StateIn<S, K>) => S[To] });
}[T[K][number] & Kind<S>];

/** The states that end on their own after a time: `{ fetching: { ms: 10_000, to: 'failed', … } }`. */
export type After<S extends Shape<S>, T extends Steps<S>> = {
	readonly [K in Kind<S>]?: Timeout<S, T, K>;
};

export interface Config<S extends Shape<S>, T extends Steps<S>, I extends Kind<S>> {
	/** Names the machine in messages and to observers (minifiers rename functions, not this). */
	name: string;
	/** The state a machine starts in. */
	initial: I;
	/** Where each state can go next. */
	steps: ExactSteps<S, T>;
	/**
	 * States that end on their own: still in the state after `ms`, the machine takes the step `to`
	 * (a step of that state, checked as it is written). A move out of it first, or `stop()`,
	 * cancels it; coming back starts the time again. In place of a timer kept by hand beside the
	 * machine, which outlives the state it was for.
	 */
	after?: After<S, T>;
}

/** A definition as data: its states and steps, for devtools, docs and tests. */
export interface MachineGraph<K extends string = string> {
	readonly name: string;
	readonly initial: K;
	readonly states: readonly {
		readonly kind: K;
		/** Where it can go next. */
		readonly steps: readonly K[];
		/** No steps out. */
		readonly final: boolean;
		/** The step it takes on its own, and after how long (`null`: made from the state's value). */
		readonly after: { readonly to: K; readonly ms: number | null } | null;
	}[];
}

/** A machine definition: written once, at the top of a module. Its machines are made by `create`. */
export interface Definition<S extends Shape<S>, T extends Steps<S>, I extends Kind<S>> {
	readonly name: string;
	readonly initial: I;
	readonly steps: T;
	/** A new machine, in `initial` (with its data, if that state has data). */
	create(...data: DataArgs<S[I]>): Machine<S, T>;
	/** Its states and steps as data. In dev and rules builds only: a production build throws
	 *  `machine_graph_off`. */
	graph(): MachineGraph<Kind<S>>;
	/**
	 * Paths from `initial` that between them take every step at least once: for each step, the
	 * shortest path that reaches its state and takes it. Drive a machine down each in a test and
	 * every move the definition allows has run. In dev and rules builds only, as `graph()`.
	 */
	paths(): Kind<S>[][];
}

/** A running machine. */
export interface Machine<S extends Shape<S>, T extends Steps<S>> {
	/**
	 * The state it is in. Read it once into a local to narrow it: `const s = m.now`. Each visit to
	 * a state is a new value, with no data too: after an `await`, `m.now === s` says the machine
	 * is still in the visit `s` was read in.
	 */
	readonly now: StateOf<S>;
	/**
	 * Go to `to` from whatever state the machine is in, if that state's steps allow it. Returns
	 * `true` when it moved. A move the steps do not allow throws in dev; in production it is
	 * refused (`false`) and printed once. A stopped machine refuses quietly.
	 */
	go<K extends T[Kind<S>][number]>(to: K, ...data: DataArgs<S[K & keyof S]>): boolean;
	/**
	 * Go from `from` to `to`, only if the machine is still in `from`: `false`, quietly, when
	 * something else moved it first. The move is checked against the steps when it is written.
	 */
	move<F extends Kind<S>, K extends T[F][number]>(
		from: F,
		to: K,
		...data: DataArgs<S[K & keyof S]>
	): boolean;
	/**
	 * The scope of the visit the machine is in now: leaving the state (or `stop()`) closes it. What
	 * hangs on it belongs to this visit alone, even when the machine comes back to the same state
	 * later:
	 *
	 * - `m.scope.task(work)`: its answer lands only in this visit, `STALE` once the machine left
	 *   (aborting `signal` then), even when `work` never finishes. After `await`, move on with
	 *   `move()`, which checks the machine is still where you expect.
	 * - `m.scope.defer(cleanup)`: runs once when the machine leaves, newest first. One that throws
	 *   does not stop the others or the move: once all have run, the move throws the error.
	 * - `m.scope.on(...)`, `.timeout(...)`, `.watch(...)`: a listener, timer or observer for this
	 *   visit only.
	 *
	 * On a stopped machine it is a closed scope: a task gives `STALE` without running, a cleanup
	 * runs at once.
	 */
	readonly scope: Scope;
	/**
	 * The next time the machine is in `kind`: at once when it is in it now. `STALE` as soon as
	 * `kind` can no longer be reached from where the machine is, or when it stops, so a wait never
	 * hangs on a state that cannot come.
	 */
	wait<K extends Kind<S>>(kind: K): Promise<Extract<StateOf<S>, { kind: K }> | Stale>;
	/** Ends the machine: leaves its state (aborting its tasks and running its cleanups), settles
	 *  its waits with `STALE`, and refuses every move after. Safe to call twice. */
	stop(): void;
}

/** Any machine, as an observer sees it. */
export interface AnyMachine {
	readonly now: { readonly kind: string };
}

/** Told about every move of every machine: `to` is `null` when the machine stopped. */
export type Observer = (
	name: string,
	from: { readonly kind: string },
	to: { readonly kind: string } | null,
	machine: AnyMachine
) => void;

/**
 * Watches every machine's moves (tests, the rules, the simulator), in dev and rules builds. Returns
 * the function that stops watching. An observer that throws is reported and does not break the
 * move. In any other build it hears nothing, and says so once (`machine_observe_off`).
 */
export function observe(observer: Observer): () => void {
	if (!RULES) {
		warn_once('machine_observe_off', {});
		return noop;
	}
	return watch_moves(observer as never);
}

export { heard };

/**
 * A machine as `machine()` hands it out: the runtime record, whose methods are `Machine`'s; each
 * visit's life is a public scope, the same through the visit.
 */
class Running extends Named {
	get scope(): Scope {
		const life = this._life as unknown as Scope | null;
		if (life !== null) return life;
		return this._stopped ? CLOSED : (this.visit() as unknown as Scope);
	}
}

/**
 * Defines a machine: first its states' data (`machine<{ ... }>()`), then its name, initial state
 * and steps. Two calls because TypeScript cannot take half the types from you and infer the
 * other half: the second call reads the exact steps, so a move they do not allow fails to compile.
 */
export function machine<S extends Shape<S>>(): <const T extends Steps<S>, const I extends Kind<S>>(
	config: Config<S, T, I>
) => Definition<S, T, I> {
	return define as never;
}

function define(config: Parameters<typeof define_run>[0]): object {
	const def = define_run(config, true, SCOPED);
	const initial = names_of(def)[def.initial]!;
	return Object.freeze({
		name: def.name,
		initial,
		steps: def.steps,
		create: (data?: object) => {
			const m = new Running(def, data);
			m._now = made(initial, data);
			return m;
		},
		graph: RULES ? () => graph_of(def) : drawn_off,
		paths: RULES ? () => paths_of(def) : drawn_off
	});
}

/** A runtime definition's graph, in dev and rules builds (`machine_graph_off` in any other). */
export function graph(def: Def): MachineGraph {
	return RULES ? graph_of(def) : drawn_off();
}

/** A runtime definition's paths, in dev and rules builds, as `Definition.paths`. */
export function paths(def: Def): string[][] {
	return RULES ? paths_of(def) : drawn_off();
}

function drawn_off(): never {
	throw machine_error('machine_graph_off', {});
}

/** A definition's state names: a compiled one has none to draw (as a production build). */
function names_of(def: Def): readonly string[] {
	return def.names ?? drawn_off();
}

function graph_of(def: Def): MachineGraph {
	const names = names_of(def);
	return {
		name: def.name,
		initial: names[def.initial]!,
		states: names.map((kind, k) => {
			const timed = def.after[k];
			return {
				kind,
				steps: def.steps[kind]!,
				final: def.steps[kind]!.length === 0,
				after:
					timed === null || timed === undefined
						? null
						: { to: names[timed.to]!, ms: typeof timed.ms === 'number' ? timed.ms : null }
			};
		})
	};
}

function next_of(def: Def, names: readonly string[], from: number): number[] {
	const out: number[] = [];
	for (const to of def.steps[names[from]!]!) {
		const t = def.ids[to];
		if (t !== undefined && !out.includes(t)) out.push(t);
	}
	return out;
}

/** For each step, the shortest path from `initial` that reaches its state and then takes it. */
function paths_of(def: Def): string[][] {
	// the shortest way to each state (breadth first)
	const names = names_of(def);
	const start = def.initial;
	const way = new Map<number, string[]>([[start, [names[start]!]]]);
	const queue = [start];
	while (queue.length > 0) {
		const k = queue.shift() as number;
		for (const to of next_of(def, names, k))
			if (!way.has(to)) {
				way.set(to, [...(way.get(k) as string[]), names[to]!]);
				queue.push(to);
			}
	}
	const out: string[][] = [];
	for (const [k, path] of way)
		for (const to of next_of(def, names, k)) out.push([...path, names[to]!]);
	return out;
}
