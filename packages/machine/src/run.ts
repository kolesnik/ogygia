/**
 * The machine runtime, as plain data and a record whose methods are its moves: what `machine()`
 * is built on, and what ogygia's own runtime calls (`runDef`, `compiledRunDef`, `createRun`).
 *
 * - A definition (`Def`) is its states as ints, each state's steps as a bitmask of the states it may
 *   go to (`masks`, `words` words of 32 bits per state: one for a machine of 32 states or fewer),
 *   and the states each one reaches in one or more steps as the same kind of mask (made on the
 *   first `wait`). A call site names a state by its key (`keys`): a move reads its steps by key
 *   (`next`: each state's steps as a table of key to int, built from the masks with the
 *   definition), so a move is one lookup.
 * - A state's key is its name, or, in a definition the build compiled (`compiledRunDef`, what
 *   `$machine` writes for a production build), its int: its call sites were compiled to its
 *   states' ints, so it carries no names (`names` is null) and its machines' `kind` is an int.
 * - A machine (`Run`) is its state's int, the data that state was entered with, and a count of its
 *   visits (`epoch`): a move looks up its step and writes a few fields, and makes no object. The state
 *   as one value (`now`) is made only when something reads it, once per visit, so `m.now === mine`
 *   still tells two visits apart; `m.epoch` does the same with no object at all.
 * - A visit's life (its scope) is made on first need and closed by the move that leaves it.
 *
 * @packageDocumentation
 */
import { DEV } from 'esm-env';
import { machine_error, report, warn_once } from './messages.ts';
import { registry, type Registry } from './registry.ts';
import { ENDED, is_time, Life, MAX_TIMEOUT_MS } from './scope.ts';
import { STALE, type Stale } from './stale.ts';
import type { Config, DataArgs, Kind, Shape, StateIn, StateOf, Steps } from './machine.ts';

/** Dev and rules builds (tests, the rules, the simulator): moves are told to observers, and a
 *  definition draws its graph and paths. Folded out of any other (../rules-env.d.ts). */
export const RULES: boolean =
	import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);

/** A machine's state as one value: its name (`kind`) and the data it was entered with. */
export type State = { readonly kind: string };

/** Told about every move of every machine: `to` is `null` when the machine stopped. */
export type Observer = (
	name: string,
	from: State,
	to: State | null,
	machine: { readonly now: State }
) => void;

/** Who watches every move, in the order they started: each held until its stop (never evicted). */
export const observers: Registry<Observer> = registry<Observer>();

/** A move of something that is not a `machine()` but keeps its states the same way (a flights'
 *  entries), told to the observers when there are any. */
export function heard(
	name: string,
	from: State,
	to: State | null,
	m: { readonly now: State }
): void {
	if (RULES && observers.size !== 0) notify(name, from, to, m);
}

function notify(name: string, from: State, to: State | null, m: { readonly now: State }): void {
	// (the watchers at the move: one that stops another during the move does not cut it off)
	const list = observers.snapshot();
	for (let i = 0; i < list.length; i++) {
		try {
			list[i]!(name, from, to, m);
		} catch (error) {
			report('machine_observer_failed', { name }, error);
		}
	}
}

/** A state's own timeout, linked to the state it steps to. */
interface Timed {
	readonly ms: number | ((now: State) => number);
	readonly to: number;
	readonly data: ((now: State) => object) | undefined;
}

/** `RunDef`: a definition as the runtime reads it (`S`, `T`, `I`: its types, for the typed calls). */
export interface Def<S = unknown, T = unknown, I = unknown> {
	/** Its types, for the typed calls (never set). */
	readonly _types?: [S, T, I];
	readonly name: string;
	/** The state names, in the order the definition wrote them (a state's int is its index), or
	 *  `null`: a definition the build compiled, which has none. */
	readonly names: readonly string[] | null;
	/** Each state's key, by int: its name, or a compiled definition's int itself. */
	readonly keys: readonly Key[];
	/** Each key's int (named: null-prototype, so a state named like an `Object.prototype` key is
	 *  itself). */
	readonly ids: Readonly<Record<Key, number>>;
	readonly initial: number;
	/** Words of 32 bits in one state's mask. */
	readonly words: number;
	/** Each state's steps: bit `to & 31` of `masks[from * words + (to >>> 5)]`. */
	readonly masks: readonly number[];
	/** Each state's steps by key: the int of each state it may go to (the same steps as `masks`). */
	readonly next: readonly Readonly<Record<Key, number>>[];
	/** The steps as written, by name (frozen): what `steps`, `graph()` and a lost `move` read
	 *  (empty when it has no names). */
	readonly steps: Readonly<Record<string, readonly string[]>>;
	/** Each state's own timeout, or null. */
	readonly after: (Timed | null)[];
	/** The states each one reaches in one or more steps, as `masks` (built on the first `wait`). */
	reach: number[] | null;
	/** Each visit's value is made as the machine enters it, a copy of the data at that moment (the
	 *  public `machine()`'s promise, whose `create` makes the first one); else on first read. */
	copies: boolean;
	/** What a visit's life is made as (the public `machine()`'s: a `Scope`, its own life). */
	life: new (label: string | null) => Life;
}

type Key = string | number;

/** The machines a definition makes: `RunOf<typeof def>`. */
export type RunOf<D> = D extends Def<infer S, infer T> ? Run<S, T> : never;

type Waiter = { kind: number; resolve: (value: State | Stale) => void };

type KindOf<S> = unknown extends S ? string : Kind<S>;
type ValueOf<S> = unknown extends S ? State : StateOf<S>;
type DataOf<S> = unknown extends S ? object | undefined : S[keyof S] & object;

/** A running machine: its state's int, that state's data, and its visits so far
 *  (`S`, `T`: its types, for the typed calls). Its moves are its methods. */
export class Run<
	// oxlint-disable-next-line typescript/no-explicit-any -- a bare `Run` takes every machine: its typed reads make it invariant in `S`, so only `any` lets every machine fit it
	S = any,
	// oxlint-disable-next-line typescript/no-explicit-any -- the same for its steps
	T = any
> {
	declare readonly _types?: [S, T];
	declare _def: Def;
	declare _k: number;
	/** The data the state it is in was entered with, not copied (`undefined`: none): a read that
	 *  makes no object, for a machine whose states all carry the same kind of data. */
	declare data: DataOf<S>;
	/** The state as one value, made on first read in this visit. */
	_now: State | null = null;
	/** Its visits so far: every move makes a new one. A value read before an `await` that still
	 *  equals it after says the machine never moved meanwhile. */
	epoch = 0;
	_stopped = false;
	/** The visit's life, once something asked for it: closed by the move that leaves the visit. */
	_life: Life | null = null;
	_waiters: Waiter[] | null = null;

	constructor(def: Def, data: object | undefined) {
		const s = def.initial;
		this._def = def;
		this._k = s;
		this.data = data as DataOf<S>;
		if (DEV) checked_data(def, s, data);
		if (def.after[s]) arm(this);
	}

	/** The state it is in, as one value: `{ kind, ...data }`, the same value through the visit, a
	 *  new one every visit (what an observer is given). */
	get now(): ValueOf<S> {
		return (this._now ?? (this._now = made(this._def.keys[this._k]!, this.data))) as ValueOf<S>;
	}

	/** The name of the state it is in (a compiled machine's: its int, as its call sites were
	 *  compiled to read it). */
	get kind(): KindOf<S> {
		return this._def.keys[this._k] as KindOf<S>;
	}

	/** The life of the visit it is in now (made on first need): closed by the move that leaves the
	 *  visit, closed for good on a stopped machine. */
	visit(): Life {
		if (this._stopped) return ENDED;
		return (this._life ??= new this._def.life(this._def.name));
	}

	/** Go to `to` from whatever state it is in, if its steps allow it (see `Machine.go`). */
	go<S extends Shape<S>, T extends Steps<S>, K extends T[Kind<S>][number]>(
		this: Run<S, T>,
		to: K,
		...data: DataArgs<S[K & keyof S]>
	): boolean;
	go(to: Key, data?: object): boolean {
		if (this._stopped) return false;
		const t = this._def.next[this._k]![to];
		if (t === undefined) return illegal(this._def, this._def.keys[this._k]!, to);
		enter(this, t, data);
		return true;
	}

	/** Go from `from` to `to`, only while it is still in `from` (see `Machine.move`). */
	move<S extends Shape<S>, T extends Steps<S>, F extends Kind<S>, K extends T[F][number]>(
		this: Run<S, T>,
		from: F,
		to: K,
		...data: DataArgs<S[K & keyof S]>
	): boolean;
	move(from: Key, to: Key, data?: object): boolean {
		if (this._stopped) return false;
		const def = this._def;
		const s = this._k;
		if (def.keys[s] === from) {
			const t = def.next[s]![to];
			if (t === undefined) return illegal(def, from, to);
			enter(this, t, data);
			return true;
		}
		const f = def.ids[from];
		if (f === undefined || def.next[f]![to] === undefined) return illegal(def, from, to);
		return false;
	}

	/** The next time it is in `name` (see `Machine.wait`). */
	wait<S, K extends Kind<S>>(this: Run<S>, name: K): Promise<StateIn<S, K> | Stale>;
	wait(name: Key): Promise<State | Stale> {
		const def = this._def;
		const k = def.ids[name];
		if (k === undefined) {
			if (DEV)
				throw machine_error('machine_unknown_state', {
					name: def.name,
					state: String(name),
					where: 'wait()'
				});
			return Promise.resolve(STALE);
		}
		if (this._stopped) return Promise.resolve(STALE);
		if (this._k === k) return Promise.resolve(value_of(this));
		if (!has(reach_of(def), def.words, this._k, k)) return Promise.resolve(STALE);
		return new Promise((resolve) => (this._waiters ??= []).push({ kind: k, resolve }));
	}

	/** Ends it (see `Machine.stop`). Safe twice. */
	stop(): void {
		if (this._stopped) return;
		this._stopped = true;
		const l = this._life;
		const waiters = this._waiters;
		this._life = null;
		this._waiters = null;
		if (waiters !== null) for (const w of waiters) w.resolve(STALE);
		if (RULES && observers.size !== 0) notify(this._def.name, value_of(this), null, this);
		if (l !== null) l.close();
	}
}

function label(def: Def, k: number): string {
	return String(def.keys[k]);
}

function checked_data(def: Def, state: number, data: object | undefined): void {
	if (data !== undefined && Object.hasOwn(data, 'kind'))
		throw machine_error('machine_kind_in_data', { name: def.name, state: label(def, state) });
}

function has(masks: readonly number[], words: number, from: number, to: number): boolean {
	return ((masks[from * words + (to >>> 5)]! >>> (to & 31)) & 1) === 1;
}

function illegal(def: Def, from: Key, to: Key): false {
	const args = { name: def.name, from: String(from), to: String(to) };
	if (DEV) throw machine_error('machine_illegal_move', args);
	warn_once('machine_illegal_move', args);
	return false;
}

interface Bare {
	_def: Def;
	_k: number;
	data: object | undefined;
	_now: State | null;
	epoch: number;
	_stopped: boolean;
	_life: Life | null;
	_waiters: Waiter[] | null;
	readonly now: State;
	visit(): Life;
	go(to: Key, data?: object): boolean;
}

function value_of(m: Bare): State {
	return m._now ?? (m._now = made(m._def.keys[m._k]!, m.data));
}

/** A state's value: its kind (a compiled machine's: its int) and the data it was entered with
 *  (frozen in dev). */
export function made(kind: Key, data: object | undefined): State {
	const value = (data === undefined ? { kind } : { ...data, kind }) as State;
	return DEV ? Object.freeze(value) : value;
}

/** The one place a move happens: the new state first, then everything the old one owned. */
function enter(m: Bare, to: number, data: object | undefined): void {
	if (RULES && observers.size !== 0) return enter_told(m, to, data);
	const def = m._def;
	if (DEV) checked_data(def, to, data);
	m._k = to;
	m.data = data;
	m._now = def.copies ? made(def.keys[to]!, data) : null;
	m.epoch++;
	// detached before anything runs, so a cleanup that moves the machine again starts clean
	const l = m._life;
	m._life = null;
	// (armed before anything else runs: a waiter or an observer that moves the machine again
	// then leaves this visit, and closing it clears this timer)
	if (def.after[to]) arm(m);
	if (m._waiters !== null) settle(m);
	if (l !== null) l.close();
}

function enter_told(m: Bare, to: number, data: object | undefined): void {
	const def = m._def;
	if (DEV) checked_data(def, to, data);
	const prev = value_of(m);
	m._k = to;
	m.data = data;
	m._now = def.copies ? made(def.keys[to]!, data) : null;
	m.epoch++;
	const l = m._life;
	m._life = null;
	if (def.after[to] !== null) arm(m);
	if (m._waiters !== null) settle(m);
	notify(def.name, prev, value_of(m), m);
	if (l !== null) l.close();
}

/**
 * The state's own time: still in this visit when it is up, the machine takes the step. Leaving
 * (or stopping) clears it. A failure while taking it (its data, a cleanup) is reported and the
 * machine stays where it is: a timer has nobody to throw to.
 */
function arm(m: Bare): void {
	const def = m._def;
	const timed = def.after[m._k]!;
	let ms: unknown;
	try {
		ms = typeof timed.ms === 'function' ? timed.ms(value_of(m)) : timed.ms;
	} catch (error) {
		report('machine_timeout_failed', { name: def.name, state: label(def, m._k) }, error);
		return;
	}
	// (a made time that is not one a timer can hold would be clamped to 1 ms: the state would end
	// at once; it does not end on its own instead, and says so)
	if (!is_time(ms)) {
		report('machine_timeout_not_a_time', {
			name: def.name,
			state: label(def, m._k),
			ms: String(ms)
		});
		return;
	}
	m.visit().later(timed_step, ms, m);
}

function timed_step(m: Bare): void {
	const def = m._def;
	const timed = def.after[m._k]!;
	const from = m._k;
	try {
		enter(m, timed.to, timed.data === undefined ? undefined : timed.data(value_of(m)));
	} catch (error) {
		report(
			'machine_timed_step_failed',
			{ name: def.name, from: label(def, from), to: label(def, timed.to) },
			error
		);
	}
}

function settle(m: Bare): void {
	const waiters = m._waiters as Waiter[];
	const def = m._def;
	const at = m._k;
	let reach: number[] | null = null;
	let kept = 0;
	for (let i = 0; i < waiters.length; i++) {
		const w = waiters[i]!;
		if (w.kind === at) w.resolve(value_of(m));
		else if (!has((reach ??= reach_of(def)), def.words, at, w.kind)) w.resolve(STALE);
		else waiters[kept++] = w;
	}
	waiters.length = kept;
	if (kept === 0 && m._waiters === waiters) m._waiters = null;
}

/** @internal The states each state reaches in one or more steps (built once, on first need). */
export function reach_of(def: Def): number[] {
	if (def.reach !== null) return def.reach;
	const { masks, words } = def;
	const n = def.keys.length;
	const reach = masks.slice();
	for (let changed = true; changed;) {
		changed = false;
		for (let k = 0; k < n; k++)
			for (let to = 0; to < n; to++) {
				if (!has(reach, words, k, to)) continue;
				for (let i = 0; i < words; i++) {
					const r = reach[k * words + i]! | masks[to * words + i]!;
					if (r !== reach[k * words + i]) {
						reach[k * words + i] = r;
						changed = true;
					}
				}
			}
	}
	return (def.reach = reach);
}

type TimeoutConfig = {
	ms: number | ((now: State) => number);
	to: string;
	data?: (now: State) => object;
};

/** @internal What a definition is written as (see `machine()`'s `Config`). */
export interface DefConfig {
	name: string;
	initial: string;
	steps: Record<string, readonly string[]>;
	after?: Record<string, TimeoutConfig | undefined>;
}

/** The checks a definition passes before its first machine: dev and tests only. */
function check(def: Def, names: readonly string[]): void {
	const { name, steps } = def;
	for (const from in steps) {
		const list = steps[from]!;
		for (let i = 0; i < list.length; i++) {
			const to = list[i]!;
			if (!(to in steps))
				throw machine_error('machine_unknown_state', {
					name,
					state: to,
					where: `a step of "${from}"`
				});
			if (list.indexOf(to) !== i) throw machine_error('machine_duplicate_step', { name, from, to });
		}
	}
	const reach = reach_of(def);
	const initial = def.initial;
	for (let k = 0; k < names.length; k++)
		if (k !== initial && !has(reach, def.words, initial, k))
			throw machine_error('machine_unreachable_state', {
				name,
				state: names[k],
				initial: names[initial]
			});
}

/** `runDef`: reads a definition into the runtime's form, refusing what cannot run (in every build:
 *  no state to start in, a timeout that is not one of its state's steps or not a time; in dev:
 *  every other mistake, `check`). */
export function define(
	config: DefConfig,
	copies = false,
	life: new (label: string | null) => Life = Life
): Def {
	const name = String(config.name);
	const steps: Record<string, readonly string[]> = Object.create(null);
	const ids: Record<string, number> = Object.create(null);
	const names: string[] = [];
	const after: (Timed | null)[] = [];
	const next: Record<string, number>[] = [];
	for (const kind of Object.keys(config.steps)) {
		steps[kind] = Object.freeze([...config.steps[kind]!]);
		ids[kind] = names.length;
		names.push(kind);
		after.push(null);
		next.push(Object.create(null));
	}
	// a machine with no state to start in cannot run at all: refused in every build
	const initial = ids[config.initial];
	if (initial === undefined)
		throw machine_error('machine_unknown_state', { name, state: config.initial, where: 'initial' });
	const n = names.length;
	const words = (n + 31) >>> 5;
	const masks: number[] = [];
	for (let i = n * words; i > 0; i--) masks.push(0);
	for (let from = 0; from < n; from++) {
		const row = next[from]!;
		for (const to of steps[names[from]!]!) {
			const t = ids[to];
			if (t === undefined) continue;
			masks[from * words + (t >>> 5)]! |= 1 << (t & 31);
			row[to] = t;
		}
	}
	const def: Def = {
		name,
		names: Object.freeze(names),
		keys: names,
		ids: Object.freeze(ids),
		initial,
		words,
		masks,
		next,
		steps: Object.freeze(steps),
		after,
		reach: null,
		copies,
		life
	};
	if (DEV) check(def, names);
	// each state's own timeout: refused in every build when it is not one of the state's steps, or
	// its time is not a time (a timer set from a bad definition would fire a move nobody allowed)
	for (const [kind, timeout] of Object.entries(config.after ?? {})) {
		if (timeout === undefined) continue;
		const k = ids[kind];
		if (k === undefined)
			throw machine_error('machine_unknown_state', { name, state: kind, where: 'after' });
		const to = next[k]![timeout.to];
		if (to === undefined)
			throw machine_error('machine_bad_timeout', {
				name,
				state: kind,
				problem: `"${timeout.to}" is not one of its steps`
			});
		const ms = timeout.ms;
		if (typeof ms !== 'function' && !is_time(ms))
			throw machine_error('machine_bad_timeout', {
				name,
				state: kind,
				problem: `its ms (${String(ms)}) is not a time of 0 to ${MAX_TIMEOUT_MS} (a timer holds no more)`
			});
		after[k] = { ms, to, data: timeout.data };
	}
	return def;
}

const NO_STEPS: Readonly<Record<string, readonly string[]>> = /* @__PURE__ */ Object.freeze(
	Object.create(null) as Record<string, readonly string[]>
);

/** A state's own timeout as the build writes it: `[state, ms, to, data]`. */
export type CompiledTimeout = readonly [
	state: number,
	ms: number | ((now: State) => number),
	to: number,
	data?: (now: State) => object
];

/**
 * `compiledRunDef`: a definition the build already read and checked (`$machine`, internal/macros): its
 * number of states, its initial state's int, each state's steps as masks (`runDef`'s layout) and
 * its timeouts, and no names: its call sites were compiled to its states' ints, so each state's
 * key is its int, its machines move by int and their `kind` is an int. What a production build
 * runs in place of `runDef`, which dev and rules builds keep (its checks, `graph()`, `paths()` and
 * the observers read names).
 */
export function compiled(
	name: string,
	size: number,
	initial: number,
	masks: readonly number[],
	timed?: readonly CompiledTimeout[]
): Def {
	const words = (size + 31) >>> 5;
	const keys: number[] = [];
	const ids: Record<Key, number> = Object.create(null);
	const after: (Timed | null)[] = [];
	const next: Record<Key, number>[] = [];
	for (let k = 0; k < size; k++) {
		keys.push(k);
		ids[k] = k;
		after.push(null);
		const row: Record<Key, number> = Object.create(null);
		for (let i = 0; i < words; i++)
			for (let bits = masks[k * words + i]!, t = i << 5; bits !== 0; bits >>>= 1, t++)
				if ((bits & 1) === 1) row[t] = t;
		next.push(row);
	}
	if (timed !== undefined) for (const [k, ms, to, data] of timed) after[k] = { ms, to, data };
	return {
		name,
		names: null,
		keys,
		ids,
		initial,
		words,
		masks,
		next,
		steps: NO_STEPS,
		after,
		reach: null,
		copies: false,
		life: Life
	};
}

/** `createRun`: a new machine of `def`, in its initial state (with `data`, if that state has data). */
export function create<S extends Shape<S>, T extends Steps<S>, I extends Kind<S>>(
	def: Def<S, T, I>,
	...data: DataArgs<S[I]>
): Run<S, T>;
export function create(def: Def, data?: object): Run {
	return new Run(def, data);
}

/** `runDefinition`: defines a machine for ogygia's own runtime, as `machine()` does (the same `Config`,
 *  the same refusals), as the runtime's plain definition: its machines are made by `createRun`. */
export function definition<S extends Shape<S>>(): <
	const T extends Steps<S>,
	const I extends Kind<S>
>(
	config: Config<S, T, I>
) => Def<S, T, I> {
	return define as never;
}

/** @internal Watches every machine's moves in dev and rules builds (see `observe`). */
export function watch_moves(observer: Observer): () => void {
	const watch = new Life();
	observers.add(observer, watch);
	return () => watch.close();
}
