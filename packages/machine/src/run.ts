/**
 * @internal The machine runtime, as plain data and free functions: what `machine()` is built on,
 * and what ogygia's own runtime calls (`@ogygia/machine/internal`).
 *
 * - A definition (`Def`) is its states as ints: their names in order (`names`), each state's steps
 *   as a bitmask of the states it may go to (`masks`, `words` words of 32 bits per state: one for
 *   a machine of 32 states or fewer), and the states each one reaches in one or more steps as the
 *   same kind of mask (made on the first `wait`).
 * - A machine (`Run`) is its state's int, the data that state was entered with, and a count of its
 *   visits (`epoch`): a move tests one bit and writes a few fields, and makes no object. The state
 *   as one value (`now`) is made only when something reads it, once per visit, so `now(m) === mine`
 *   still tells two visits apart; `epoch(m)` does the same with no object at all.
 * - A visit's life (its scope) is made on first need and closed by the move that leaves it.
 *
 * @packageDocumentation
 */
import { DEV } from 'esm-env';
import { machine_error, report, warn_once } from './messages.ts';
import { registry, type Registry } from './registry.ts';
import { close, ENDED, is_time, later, Life, MAX_TIMEOUT_MS, root } from './scope.ts';
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

/** @internal A definition as the runtime reads it (`S`, `T`, `I`: its types, for the typed calls). */
export interface Def<S = unknown, T = unknown, I = unknown> {
	/** Its types, for the typed calls (never set). */
	readonly _types?: [S, T, I];
	readonly name: string;
	/** The state names, in the order the definition wrote them: a state's int is its index. */
	readonly names: readonly string[];
	/** Each name's int (null-prototype: a state named like an `Object.prototype` key is itself). */
	readonly ids: Readonly<Record<string, number>>;
	readonly initial: number;
	/** Words of 32 bits in one state's mask. */
	readonly words: number;
	/** Each state's steps: bit `to & 31` of `masks[from * words + (to >>> 5)]`. */
	readonly masks: readonly number[];
	/** The steps as written, by name (frozen): what `steps`, `graph()` and a lost `move` read. */
	readonly steps: Readonly<Record<string, readonly string[]>>;
	/** Each state's own timeout, or null. */
	readonly after: (Timed | null)[];
	/** The states each one reaches in one or more steps, as `masks` (built on the first `wait`). */
	reach: number[] | null;
	/** Each visit's value is made as the machine enters it, a copy of the data at that moment (the
	 *  public `machine()`'s promise); else on first read. */
	copies: boolean;
	/** What a visit's life is made as (the public `machine()`'s: a `Scope`, its own life). */
	life: new (parent: Life | null, label: string | null) => Life;
}

/** @internal The machines a definition makes: `RunOf<typeof def>`. */
export type RunOf<D> = D extends Def<infer S, infer T> ? Run<S, T> : never;

type Waiter = { kind: number; resolve: (value: State | Stale) => void };

/** @internal A running machine: its state's int, that state's data, and its visits so far
 *  (`S`, `T`: its types, for the typed calls). */
export class Run<S = unknown, T = unknown> {
	declare readonly _types?: [S, T];
	_def: Def;
	_state: number;
	_data: object | undefined;
	/** The state as one value, made on first read in this visit. */
	_now: State | null = null;
	/** Its visits so far: every move makes a new one. */
	_epoch = 0;
	_stopped = false;
	/** The visit's life, once something asked for it: closed by the move that leaves the visit. */
	_life: Life | null = null;
	_waiters: Waiter[] | null = null;

	constructor(def: Def, data: object | undefined) {
		this._def = def;
		this._state = def.initial;
		this._data = data;
		if (DEV) checked_data(def, def.initial, data);
		if (def.copies) this._now = made(def.names[def.initial]!, data);
		const timed = def.after[def.initial];
		if (timed !== null) arm(this, timed);
	}

	/** The state as one value (what an observer is given). */
	get now(): State {
		return value_of(this);
	}
}

function checked_data(def: Def, state: number, data: object | undefined): void {
	if (data !== undefined && Object.hasOwn(data, 'kind'))
		throw machine_error('machine_kind_in_data', { name: def.name, state: def.names[state] });
}

function has(masks: readonly number[], words: number, from: number, to: number): boolean {
	return ((masks[from * words + (to >>> 5)]! >>> (to & 31)) & 1) === 1;
}

function illegal(def: Def, from: string, to: string): false {
	const args = { name: def.name, from, to };
	if (DEV) throw machine_error('machine_illegal_move', args);
	warn_once('machine_illegal_move', args);
	return false;
}

/** @internal The state `m` is in, as one value: `{ kind, ...data }`, the same value through the
 *  visit, a new one every visit. */
export const now: <S>(m: Run<S>) => StateOf<S> = value_of as never;

function value_of(m: Run): State {
	return m._now ?? (m._now = made(m._def.names[m._state]!, m._data));
}

function made(kind: string, data: object | undefined): State {
	const value = data === undefined ? { kind } : { ...data, kind };
	return DEV ? Object.freeze(value) : value;
}

/** @internal The name of the state `m` is in. */
export const kind: <S>(m: Run<S>) => Kind<S> = kind_of as never;

function kind_of(m: Run): string {
	return m._def.names[m._state]!;
}

/** @internal It is in state `name`. */
export const is: <S>(m: Run<S>, name: Kind<S>) => boolean = is_in as never;

function is_in(m: Run, name: string): boolean {
	return m._def.names[m._state] === name;
}

/** @internal Its visits so far: a value read before an `await` that still equals it after says the
 *  machine never moved meanwhile. */
export function epoch(m: Run): number {
	return m._epoch;
}

/** @internal The data the state it is in was entered with, not copied (`undefined`: none): a
 *  read that makes no object, for a machine whose states all carry the same kind of data. */
export const data: <S>(m: Run<S>) => S[keyof S] = data_of as never;

function data_of(m: Run): object | undefined {
	return m._data;
}

/** @internal The life of the visit `m` is in now (made on first need): closed by the move that
 *  leaves the visit, closed for good on a stopped machine. */
export function visit(m: Run): Life {
	if (m._stopped) return ENDED;
	return (m._life ??= new m._def.life(null, m._def.name));
}

/** @internal Go to `to` from whatever state `m` is in, if its steps allow it (see `Machine.go`). */
export const go: <S extends Shape<S>, T extends Steps<S>, K extends T[Kind<S>][number]>(
	m: Run<S, T>,
	to: K,
	...data: DataArgs<S[K & keyof S]>
) => boolean = go_to as never;

/** @internal `go` by any name, untyped (the public `Machine.go`). */
export function go_to(m: Run, to: string, data?: object): boolean {
	if (m._stopped) return false;
	const def = m._def;
	const t = def.ids[to];
	const w = def.words;
	const s = m._state;
	if (
		t === undefined ||
		((w === 1 ? def.masks[s]! >>> t : def.masks[s * w + (t >>> 5)]! >>> (t & 31)) & 1) === 0
	)
		return illegal(def, def.names[s]!, to);
	enter(m, t, data);
	return true;
}

/** @internal Go from `from` to `to`, only while `m` is still in `from` (see `Machine.move`). */
export const move: <
	S extends Shape<S>,
	T extends Steps<S>,
	F extends Kind<S>,
	K extends T[F][number]
>(
	m: Run<S, T>,
	from: F,
	to: K,
	...data: DataArgs<S[K & keyof S]>
) => boolean = move_from as never;

/** @internal `move` by any names, untyped (the public `Machine.move`). */
export function move_from(m: Run, from: string, to: string, data?: object): boolean {
	if (m._stopped) return false;
	const def = m._def;
	if (def.names[m._state] === from) return go_to(m, to, data);
	const f = def.ids[from];
	const t = def.ids[to];
	const w = def.words;
	if (
		f === undefined ||
		t === undefined ||
		((w === 1 ? def.masks[f]! >>> t : def.masks[f * w + (t >>> 5)]! >>> (t & 31)) & 1) === 0
	)
		return illegal(def, from, to);
	return false;
}

/** @internal The next time `m` is in `name` (see `Machine.wait`). */
export const wait: <S, K extends Kind<S>>(m: Run<S>, name: K) => Promise<StateIn<S, K> | Stale> =
	wait_for as never;

/** @internal `wait` by any name, untyped (the public `Machine.wait`). */
export function wait_for(m: Run, name: string): Promise<State | Stale> {
	const def = m._def;
	const k = def.ids[name];
	if (k === undefined) {
		if (DEV)
			throw machine_error('machine_unknown_state', {
				name: def.name,
				state: name,
				where: 'wait()'
			});
		return Promise.resolve(STALE);
	}
	if (m._stopped) return Promise.resolve(STALE);
	if (m._state === k) return Promise.resolve(value_of(m));
	if (!has(reach_of(def), def.words, m._state, k)) return Promise.resolve(STALE);
	return new Promise((resolve) => (m._waiters ??= []).push({ kind: k, resolve }));
}

/** @internal Ends `m` (see `Machine.stop`). Safe twice. */
export function stop(m: Run): void {
	if (m._stopped) return;
	m._stopped = true;
	const l = m._life;
	const waiters = m._waiters;
	m._life = null;
	m._waiters = null;
	if (waiters !== null) for (const w of waiters) w.resolve(STALE);
	if (RULES && observers.size !== 0) notify(m._def.name, value_of(m), null, m);
	if (l !== null) close(l);
}

/** The one place a move happens: the new state first, then everything the old one owned. */
function enter(m: Run, to: number, data: object | undefined): void {
	const def = m._def;
	if (DEV) checked_data(def, to, data);
	const told = RULES && observers.size !== 0;
	const prev = told ? value_of(m) : null;
	m._state = to;
	m._data = data;
	m._now = def.copies ? made(def.names[to]!, data) : null;
	m._epoch++;
	// detached before anything runs, so a cleanup that moves the machine again starts clean
	const l = m._life;
	m._life = null;
	// (armed before anything else runs: a waiter or an observer that moves the machine again
	// then leaves this visit, and closing it clears this timer)
	const timed = def.after[to];
	if (timed !== null) arm(m, timed);
	if (m._waiters !== null) settle(m);
	if (told) notify(def.name, prev!, value_of(m), m);
	if (l !== null) close(l);
}

/**
 * The state's own time: still in this visit when it is up, the machine takes the step. Leaving
 * (or stopping) clears it. A failure while taking it (its data, a cleanup) is reported and the
 * machine stays where it is: a timer has nobody to throw to.
 */
function arm(m: Run, timed: Timed): void {
	const def = m._def;
	let ms: unknown;
	try {
		ms = typeof timed.ms === 'function' ? timed.ms(value_of(m)) : timed.ms;
	} catch (error) {
		report('machine_timeout_failed', { name: def.name, state: def.names[m._state] }, error);
		return;
	}
	// (a made time that is not one a timer can hold would be clamped to 1 ms: the state would end
	// at once; it does not end on its own instead, and says so)
	if (!is_time(ms)) {
		report('machine_timeout_not_a_time', {
			name: def.name,
			state: def.names[m._state],
			ms: String(ms)
		});
		return;
	}
	// (the visit's own timer: leaving closes its life, which clears it, so it only ever fires in
	// the visit that set it; and it never keeps a server process alive)
	later(visit(m), timed_step, ms, m);
}

function timed_step(m: Run): void {
	const def = m._def;
	const timed = def.after[m._state]!;
	const from = def.names[m._state];
	try {
		enter(m, timed.to, timed.data === undefined ? undefined : timed.data(value_of(m)));
	} catch (error) {
		report('machine_timed_step_failed', { name: def.name, from, to: def.names[timed.to] }, error);
	}
}

function settle(m: Run): void {
	const waiters = m._waiters as Waiter[];
	const def = m._def;
	const at = m._state;
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
	const n = def.names.length;
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
function check(def: Def): void {
	const { name, steps, names } = def;
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

/** @internal Reads a definition into the runtime's form, refusing what cannot run (in every build:
 *  no state to start in, a timeout that is not one of its state's steps or not a time; in dev:
 *  every other mistake, `check`). */
export function define(
	config: DefConfig,
	copies = false,
	life: new (parent: Life | null, label: string | null) => Life = Life
): Def {
	const name = String(config.name);
	const steps: Record<string, readonly string[]> = Object.create(null);
	const ids: Record<string, number> = Object.create(null);
	const names: string[] = [];
	for (const kind of Object.keys(config.steps)) {
		steps[kind] = Object.freeze([...config.steps[kind]!]);
		ids[kind] = names.length;
		names.push(kind);
	}
	// a machine with no state to start in cannot run at all: refused in every build
	const initial = ids[config.initial];
	if (initial === undefined)
		throw machine_error('machine_unknown_state', { name, state: config.initial, where: 'initial' });
	const n = names.length;
	const words = (n + 31) >>> 5;
	const masks: number[] = Array.from({ length: n * words }, () => 0);
	// (a production build skips a step naming no state, which dev refuses below: the move to it is
	// then refused like any other)
	for (let from = 0; from < n; from++)
		for (const to of steps[names[from]!]!) {
			const t = ids[to];
			if (t !== undefined) masks[from * words + (t >>> 5)]! |= 1 << (t & 31);
		}
	const after: (Timed | null)[] = names.map(() => null);
	const def: Def = {
		name,
		names: Object.freeze(names),
		ids: Object.freeze(ids),
		initial,
		words,
		masks,
		steps: Object.freeze(steps),
		after,
		reach: null,
		copies,
		life
	};
	if (DEV) check(def);
	// each state's own timeout: refused in every build when it is not one of the state's steps, or
	// its time is not a time (a timer set from a bad definition would fire a move nobody allowed)
	for (const [kind, timeout] of Object.entries(config.after ?? {})) {
		if (timeout === undefined) continue;
		const k = ids[kind];
		if (k === undefined)
			throw machine_error('machine_unknown_state', { name, state: kind, where: 'after' });
		const to = ids[timeout.to];
		if (to === undefined || !has(masks, words, k, to))
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

/** @internal A new machine of `def`, in its initial state (with `data`, if that state has data). */
export function create<S extends Shape<S>, T extends Steps<S>, I extends Kind<S>>(
	def: Def<S, T, I>,
	...data: DataArgs<S[I]>
): Run<S, T>;
export function create(def: Def, data?: object): Run {
	return new Run(def, data);
}

/** @internal Defines a machine for ogygia's own runtime, as `machine()` does (the same `Config`,
 *  the same refusals), as the runtime's plain definition: its machines are made by `create`. */
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
	const watch = root();
	observers.add(observer, watch);
	return () => close(watch);
}
