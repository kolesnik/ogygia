/**
 * Keyed async work that callers share: one flight per key at a time, its answer kept for as long
 * as you say, and never a failure.
 *
 *   const pages = flights({
 *     run: (href: string, signal) => fetch(href, { signal }).then((r) => r.text()),
 *     keep: 8_000
 *   });
 *   const html = await pages.get('/docs', { signal }); // joins the fetch already out for it
 *   if (html === STALE) return; // dropped, or this caller left
 *
 *   const download = policy({ attempts: 2, backoff: 0, jitter: 0, deadline: Infinity });
 *   const core = flights({ run: () => import('./hydrate-core.ts'), retry: download }); // one key
 *   const mod = await core.get();
 *
 *   const checkouts = flights.keyed<Spec>()({      // an object input, keyed by some of its fields
 *     key: ['owner', 'repo', 'ref', 'sub'],
 *     ignore: { depth: 'how much history to fetch, not which files' },
 *     run: ({ owner, repo, ref, sub, depth }, signal) => checkout(owner, repo, ref, sub, depth, signal)
 *   });
 *
 * - `get` joins the flight out for its key, else gives the kept answer, else starts a flight, and
 *   `run` starts inside that `get`. The key is the input itself (by `Map` identity), or, keyed, the
 *   fields `key` names: `run` (and `keep`, `weigh`) is handed the input typed to those fields only,
 *   so work that reads a field its key leaves out does not compile, unless `ignore` names that field
 *   with the reason (the input of the call that started the flight is then the one that runs).
 *   `peek` and `drop` name a keyed flights' keys by those fields too (`peek({ href })`). The fields
 *   are spelled into one string one way everywhere (one field is its own key): a string by its
 *   text, an object by identity (a field left out and one set to `undefined` are one key; `1` and
 *   `'1'` are two).
 * - A failure (after the tries its `retry` policy gives, inside the one flight) fails every caller
 *   that joined it, and is never kept: the next `get` starts a new flight. A failing key costs one
 *   round of tries per wave of callers, not one per caller.
 * - `keep` is how long an answer stays (ms: a number, or made from the answer; 0 keeps nothing,
 *   the default keeps it until `max` lets it go). `max` caps the total `weigh` of what is kept
 *   (default 1000: with the default weight, 1000 answers): past it, the expired go first, then the
 *   least recently used.
 * - `drop` takes kept answers out and ends the flights in progress: their signal aborts, every
 *   caller that joined them gets `STALE`, and nothing they answer is kept.
 * - A caller may bring a `signal`: when it aborts, that caller alone gets `STALE` at once, and the
 *   work is aborted only once the last caller has left. A caller with no signal holds the flight
 *   until it lands.
 * - `fresh` starts a new flight even when an answer is kept; the kept one stays (and `peek` shows
 *   it) until the new one lands, and stays when the new one fails or is not kept.
 * - A caller may bring a `priority` (a number, higher is sooner; default 0). A flight is at the
 *   highest priority of the callers that joined it: a `get` with a higher one raises it, a lower
 *   one never lowers it, and a caller that leaves does not take its raise back. `run` gets the
 *   flight as its third argument, to read `priority` and hear each raise (`onRaise`), so it can
 *   lift its own work where the platform lets it (a queued download, a fetch priority not sent
 *   yet). A kept answer is given as it is: nothing runs, so nothing is raised.
 *
 *     const chunks = flights({
 *       run: (url: string, signal, flight) => {
 *         const link = preload(url, flight.priority);
 *         flight.onRaise((p) => (link.fetchPriority = p > 1 ? 'high' : 'auto'));
 *         return loaded(link, signal);
 *       }
 *     });
 *     void chunks.get(url, { priority: 0 }); // a guess
 *     await chunks.get(url, { priority: 2 }); // the visitor needs it: the guess is raised
 *
 * - A `world` (`world()`) is what its answers are made in. A move of it is a `drop` of what the
 *   move touches; and an answer whose world moved while it was out is `STALE` for every caller that
 *   joined it, and never kept. With a keyed world, `touches` says which keys an answer was made
 *   from: a move of other keys leaves it be, and a flight with nothing kept yet goes on, judged by
 *   its answer when it lands.
 *
 * Each key's entry is a plain record in one of three states (`flying`, `kept`, `gone`), and the
 * work of a flight is a `scope.task` of its own: ending the flight (a drop, the last caller gone, a
 * fresh flight in its place) closes that scope, which aborts the work and turns its answer into
 * STALE. `observe()` hears every entry's moves, under the flights' `name`. The kept answers are
 * bounded by weight in the entries themselves: no machine and no cache under them, so a flights
 * costs little to make and a kept read is a look-up.
 */
import { buggify, clock } from './ports.ts';
import { heard } from './run.ts';
import {
	attempt,
	Flight,
	FLYING,
	join,
	priority_of,
	keep_of,
	retry_of,
	STALE_NOW,
	type FlightEntry,
	type GetArgs,
	type GetOptions,
	type InFlight
} from './flight.ts';
import { bad_option, machine_error } from './messages.ts';
import { noop } from './noop.ts';
import type { Policy } from './policy.ts';
import { DISPOSE, Life } from './scope.ts';
import { STALE, type Fresh, type Stale } from './stale.ts';
import { watch_world, type World } from './world.ts';

/** Dev and rules builds (buggify points); folded out of any other (../rules-env.d.ts). */
const RULES =
	import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);

/** What every flights takes; `R` is what `run` (and `keep`, `weigh`) may read of an input. */
interface FlightsCommon<R, V, W> {
	/** Names its flights in messages and to observers. Default `flights`. */
	name?: string;
	/** The work for an input: started by the `get` that finds no flight and no kept answer. `flight`
	 *  is its priority, raised by the callers that join it. */
	run: (input: R, signal: AbortSignal, flight: InFlight) => V;
	/** How long an answer stays, in ms: a number, or made from the answer and its input. 0 keeps
	 *  nothing (callers share the flight while it is out); the default, `Infinity`, keeps it until
	 *  `max` lets it go. A failure is never kept. */
	keep?: number | ((answer: Fresh<Awaited<V>>, input: R) => number);
	/** The most total weight it keeps (a finite number more than 0); past it, the least recently
	 *  used answers go. Default 1000 (answers, with the default weight); required with `weigh`. */
	max?: number;
	/** An answer's weight against `max` (bytes, say). Default 1: `max` then counts answers. An
	 *  answer heavier than `max`, or with a weight below 0 or not a number, is not kept. */
	weigh?: (answer: Fresh<Awaited<V>>, input: R) => number;
	/** How a failed run is tried again, inside one flight, before it fails (`policy()`): its tries,
	 *  the waits between them (none when 0: the next try runs at once) and its deadline. Default:
	 *  one try. */
	retry?: Policy;
	/** The world the answers are made in (`world()`): when it moves, what the move touches goes (a
	 *  kept answer, and the flight out for it), and an answer whose world moved while it was out is
	 *  `STALE` for every caller that joined it, and never kept. */
	world?: World<W>;
	/** The keys of a keyed `world` an answer was made from: a move of other keys leaves it (and a
	 *  flight out, judged by its answer once it lands) be. Without it, any move touches every answer. */
	touches?: (answer: Fresh<Awaited<V>>) => Iterable<W>;
}

/** A flights whose key is its whole input (by `Map` identity: a string, a number, an object
 *  itself), or of one key when it takes none. */
export interface FlightsOptions<I, V, W = never> extends FlightsCommon<I, V, W> {}

/** A flights over an object input whose key is some of its fields (`flights.keyed<I>()({ key, … })`):
 *  `run` reads only the fields its key names, and those `ignore` names with the reason it may. */
export interface KeyedFlightsOptions<
	I,
	F extends keyof I,
	G extends Exclude<keyof I, F>,
	V,
	W = never
> extends FlightsCommon<Pick<I, F | G>, V, W> {
	/** The fields that make the key: two inputs that agree on them are one flight. It must list
	 *  every field the work reads (`run`'s input holds no other), unless `ignore` says why not. */
	key: readonly F[];
	/** Fields the work reads that are left out of the key on purpose, each with its reason (the
	 *  input of the call that started the flight is the one that runs): `{ depth: 'how much
	 *  history to fetch, not which files' }`. */
	ignore?: { readonly [field in G]: string };
}

export type { FlightEntry, GetArgs, GetOptions, InFlight };

export interface Flights<I, V, K = I> {
	/** The answer for `input`: joined, kept, or from a new flight. `STALE` when it was dropped (or
	 *  superseded by a fresh one) before it landed, or this caller's `signal` aborted. */
	get(...args: GetArgs<I>): Promise<V | Stale>;
	/** What `key` holds now, without starting anything or counting as a use. */
	peek(key: K): FlightEntry<V> | undefined;
	/** Takes `key` out (or every key `which` says yes to): a kept answer goes, a flight out is ended
	 *  and its callers get `STALE`. (A key that is itself a function is dropped with a predicate.) */
	drop(which: K | ((key: K, entry: FlightEntry<V>) => boolean)): void;
	/** Drops every key, and every later `get` gives `STALE` without running: for a scope to adopt. */
	[Symbol.dispose](): void;
}

/** The most total weight a flights keeps when its options do not say (1000 answers). */
const DEFAULT_MAX = 1000;
/** Ids for the objects (and symbols) a key holds: a key field compares by identity. Held weakly:
 *  an object or a symbol made per request is freed once nothing else holds it. */
const weak_ids = new WeakMap<WeakKey, number>();
/** A runtime that cannot hold a symbol weakly (no symbols as WeakMap keys) holds them here. */
let symbol_ids: Map<symbol, number> | null = null;
let next_id = 0;

function id_of(v: object | symbol): number {
	let id = weak_ids.get(v as WeakKey) ?? symbol_ids?.get(v as symbol);
	if (id !== undefined) return id;
	id = next_id++;
	try {
		weak_ids.set(v as WeakKey, id);
	} catch {
		(symbol_ids ??= new Map()).set(v as symbol, id);
	}
	return id;
}

/** One field of a key, spelled so that two different values never spell one string: a string is
 *  its length, then itself; any other value its kind, then itself, then `;`. */
function key_part(v: unknown): string {
	switch (typeof v) {
		case 'string':
			return `s${v.length}:${v}`;
		case 'number':
			return `n${v};`; // (0 and -0 are one key, as in a Map)
		case 'bigint':
			return `g${v};`;
		case 'boolean':
			return v ? 't;' : 'f;';
		case 'undefined':
			return 'u;';
		case 'symbol': {
			// a registered symbol is one per name for good (`Symbol.for`): spelled by its name
			const name = Symbol.keyFor(v);
			if (name !== undefined) return `Y${name.length}:${name}`;
			return `y${id_of(v)};`;
		}
		default:
			return v === null ? 'z;' : `o${id_of(v as object)};`;
	}
}

/** The key of a keyed flights' input: its key fields, in their order, spelled one way. One field is
 *  its own key: a Map tells values apart exactly as their spelling does, with no string to make. */
export function key_of(fields: readonly PropertyKey[], input: unknown): unknown {
	const of = input as Record<PropertyKey, unknown>;
	if (fields.length === 1) return of[fields[0]!];
	let key = '';
	for (const f of fields) key += key_part(of[f]);
	return key;
}

/** A kept answer: the entry's `kept` state itself, so an observer reads the answer off the move. */
type Kept = {
	readonly kind: 'kept';
	answer: unknown;
	/** When it landed, on the wall clock (a timestamp a caller may show or compare outside). */
	at: number;
	/** When it expires, on the monotonic clock (`clock.mono()`): a wall step never moves it. */
	until: number;
	weight: number;
	/** The settled promise every later `get` of it is handed (so `get() === get()`). */
	promise: Promise<unknown>;
};

const FLYING_NOW = { kind: 'flying' } as const;
const GONE_NOW = { kind: 'gone' } as const;

/** The steps an entry may take, as data: the simulator's coverage reads this table for every
 *  flights' targets, and a rules build refuses any other move (`_move`). */
const ENTRY_STEPS: { readonly [K in 'flying' | 'kept' | 'gone']: readonly string[] } = {
	flying: ['flying', 'kept', 'gone'],
	kept: ['flying', 'gone'],
	gone: []
};

/**
 * A key's entry: `flying` (a flight out, with the answer kept before it beside it, if any), `kept`
 * (an answer, `flight` null) or `gone` (out of the flights). It moves flying → kept | flying | gone,
 * kept → flying | gone, and each move is told to `observe()`'s observers under the flights' name.
 */
class Entry {
	now: { readonly kind: 'flying' | 'kept' | 'gone' } = FLYING_NOW;
	flight: Flight | null;
	/** The flight's work: closing it aborts the run and makes its answer `STALE`. */
	work: Life | null;
	/** The answer it keeps: its own once kept; while flying, the one kept before the flight. */
	held: Kept | null;
	/** Its last use, in the flights' count of uses: the least recently used go first past `max`. */
	used = 0;

	constructor(flight: Flight, work: Life, held: Kept | null) {
		this.flight = flight;
		this.work = work;
		this.held = held;
	}
}

const expired = (k: Readonly<Kept>, now: number): boolean => k.until !== Infinity && now >= k.until;

class Flown<I, V, K> implements Flights<I, V, K> {
	_run: (input: I, signal: AbortSignal, flight: InFlight) => unknown;
	_name: string;
	/** A keyed flights' key fields (`null`: the input itself is the key). */
	_fields: readonly PropertyKey[] | null;
	/** A keyed flights' keys as callers name them (its key fields), by the spelled key. */
	_keys: Map<unknown, K> | null;
	_keep: number | ((answer: V, input: I) => number);
	_max: number;
	_weigh: ((answer: V, input: I) => number) | undefined;
	_retry: Policy | null;
	_world: World<unknown> | undefined;
	_touches: ((answer: V) => Iterable<unknown>) | undefined;
	/** Stops hearing the world (on dispose). */
	_unwatch: () => void = noop;
	/** By key: the input itself, or (keyed) the spelled key. Every entry, flying or kept, in the
	 *  order its first flight started. */
	_entries = new Map<unknown, Entry>();
	/** The total weight of the answers its entries keep. */
	_weight = 0;
	_uses = 0;
	_disposed = false;

	constructor(
		o: FlightsCommon<I, unknown, unknown> & {
			key?: readonly PropertyKey[];
			ignore?: Record<PropertyKey, string>;
		}
	) {
		if (typeof o?.run !== 'function') throw bad_option('run', typeof o?.run, 'a function');
		this._fields = null;
		this._keys = null;
		if (o.key !== undefined) {
			const fields = o.key;
			if (!Array.isArray(fields) || new Set(fields).size !== fields.length)
				throw bad_option('key', String(fields), 'a list of the input fields that make the key');
			for (const [field, why] of Object.entries(o.ignore ?? {})) {
				if (fields.includes(field))
					throw bad_option('ignore', field, 'a field the key leaves out, not one of its fields');
				if (typeof why !== 'string' || why.trim() === '')
					throw bad_option('ignore', field, 'the reason the key leaves it out');
			}
			this._fields = Object.freeze([...fields]);
			this._keys = new Map();
		} else if (o.ignore !== undefined) throw bad_option('ignore', 'without key', 'beside a key');
		const retry = retry_of(o.retry);
		const keep = keep_of(o.keep);
		// (the default counts answers: a weigh in another unit, bytes say, would keep nothing past it)
		if (o.weigh !== undefined && o.max === undefined)
			throw bad_option('max', 'missing', 'given with weigh, in its unit');
		const max = o.max ?? DEFAULT_MAX;
		if (!(typeof max === 'number' && max > 0 && Number.isFinite(max)))
			throw bad_option('max', max, 'a finite number more than 0');
		this._run = o.run;
		this._name = o.name ?? 'flights';
		this._keep = keep as number | ((answer: V, input: I) => number);
		this._max = max;
		this._weigh = o.weigh as ((answer: V, input: I) => number) | undefined;
		this._retry = retry;
		this._world = o.world;
		this._touches = o.touches as ((answer: V) => Iterable<unknown>) | undefined;
		if (o.world !== undefined) {
			// (heard for itself, held weakly: a flights nobody holds is collected, its world forgets it)
			const unwatch = watch_world(o.world, this, heard_move);
			if (unwatch === null) throw bad_option('world', typeof o.world, 'a world from world()');
			this._unwatch = unwatch;
		}
	}

	/** The world moved: what the move touches goes. With no `touches` (or the whole world moved),
	 *  that is everything; else the kept answers made from a moved key (a flight out beside one
	 *  goes with it; one with nothing kept yet is judged by its answer when it lands). */
	_moved(keys: ReadonlySet<unknown> | null): void {
		const touches = this._touches;
		if (keys === null || touches === undefined) return this.drop(() => true);
		this.drop((_, entry) => {
			if (entry.kind !== 'kept') return false;
			let read: Iterable<unknown>;
			try {
				read = touches(entry.answer);
			} catch {
				return true; // (what it read cannot be told: made again, never kept past the move)
			}
			for (const k of read) if (keys.has(k)) return true;
			return false;
		});
	}

	/** Whether an answer that landed is still of the world its flight started in. */
	_current(flight: Flight, answer: V): boolean {
		const w = this._world;
		if (w === undefined) return true;
		const touches = this._touches;
		return touches === undefined ? w.fresh(flight.stamp) : w.fresh(flight.stamp, touches(answer));
	}

	get(input?: I, options?: GetOptions): Promise<V | Stale> {
		if (this._disposed) return STALE_NOW;
		let signal: AbortSignal | undefined;
		let priority = 0;
		let fresh = false;
		if (options !== undefined) {
			signal = options.signal;
			if (signal?.aborted) return STALE_NOW;
			priority = priority_of(options);
			fresh = options.fresh === true;
		}
		const fields = this._fields;
		const key = fields === null ? input : key_of(fields, input);
		let e = this._entries.get(key);
		if (e !== undefined) {
			const flight = e.flight;
			if (flight !== null) {
				if (!fresh) {
					flight._raise(priority);
					return this._join(key, e, flight, signal);
				}
			} else {
				const held = e.held!;
				if (held.until !== Infinity && clock.mono() >= held.until) {
					this._remove(key, e);
					e = undefined;
				} else if (RULES && buggify.fires('flights.evicted-early')) {
					// (buggify: its keep ran out just now, as a short keep's or a full cache's would: the
					// entry goes, and this caller runs the work again)
					this._remove(key, e);
					e = undefined;
				} else if (!fresh) {
					e.used = ++this._uses;
					return held.promise as Promise<V>;
				}
			}
		}
		return this._fly(key, e, input as I, priority, signal);
	}

	/** The entry key of a key as callers name it (keyed: its fields, spelled). */
	_entry_key(key: K): unknown {
		return this._fields === null ? key : key_of(this._fields, key);
	}

	peek(key: K): FlightEntry<V> | undefined {
		const e = this._entries.get(this._entry_key(key));
		return e === undefined ? undefined : this._view(e, clock.mono());
	}

	drop(which: K | ((key: K, entry: FlightEntry<V>) => boolean)): void {
		if (typeof which !== 'function') {
			const key = this._entry_key(which);
			const e = this._entries.get(key);
			if (e !== undefined) this._remove(key, e);
			return;
		}
		const test = which as (key: K, entry: FlightEntry<V>) => boolean;
		const keys = this._keys;
		const now = clock.mono();
		// (a Map lets an entry be deleted while it is walked)
		for (const [key, e] of this._entries) {
			const view = this._view(e, now);
			if (view === undefined || test(keys === null ? (key as K) : keys.get(key)!, view))
				this._remove(key, e);
		}
	}

	[DISPOSE](): void {
		this._disposed = true;
		this._unwatch();
		this.drop(() => true);
	}

	/** What an entry shows (`undefined`: its answer expired). */
	_view(e: Entry, now: number): FlightEntry<V> | undefined {
		const held = e.held;
		if (e.flight === null)
			return held === null || expired(held, now)
				? undefined
				: { kind: 'kept', answer: held.answer as V, at: held.at, flying: false };
		return held === null || expired(held, now)
			? FLYING
			: { kind: 'kept', answer: held.answer as V, at: held.at, flying: true };
	}

	/** Starts a flight for `key` at `priority`, on its entry when it has one (a fresh flight: the
	 *  one out is ended, the answer kept stays beside the new one). */
	_fly(
		key: unknown,
		e: Entry | undefined,
		input: I,
		priority: number,
		signal: AbortSignal | undefined
	): Promise<V | Stale> {
		const stamp = this._world === undefined ? 0 : this._world.stamp();
		// the shared answer is there before the run starts: a run that gets its own key (before it
		// returns) joins this flight (#354)
		let resolve!: (answer: unknown) => void;
		let reject!: (error: unknown) => void;
		const shared = new Promise<unknown>((res, rej) => {
			resolve = res;
			reject = rej;
		});
		const flight = new Flight(shared, stamp, priority, this._name);
		const work = new Life();
		let entry: Entry;
		if (e !== undefined) {
			entry = e;
			const before = e.work;
			e.flight = flight;
			e.work = work;
			this._move(e, FLYING_NOW);
			if (before !== null) before.close();
		} else {
			entry = new Entry(flight, work, null);
			this._entries.set(key, entry);
			const fields = this._fields;
			if (fields !== null) {
				// the key as callers name it (drop's predicate): its fields only, never the rest
				const named: Record<PropertyKey, unknown> = {};
				for (const f of fields) named[f] = (input as Record<PropertyKey, unknown>)[f];
				this._keys!.set(key, named as K);
			}
		}
		const run = this._run;
		const retry = this._retry;
		const landed = (answer: unknown): unknown => {
			if (entry.flight !== flight) return STALE;
			// (its run answered STALE: kept by nobody, like a failure; the key goes back to what it
			// held, so the next get runs again, #377. Its task already made a stale part a stale
			// whole, #378.)
			if (answer === STALE) {
				this._back(key, entry);
				return STALE;
			}
			let current: boolean;
			try {
				current = this._current(flight, answer as V);
			} catch (error) {
				this._back(key, entry);
				throw error;
			}
			// its world moved while it was out: made from facts that are gone, so no caller has it
			if (!current) {
				this._back(key, entry);
				return STALE;
			}
			this._land(key, entry, input, answer as V, shared);
			return answer;
		};
		const failed = (error: unknown): unknown => {
			if (entry.flight !== flight) return STALE;
			this._back(key, entry);
			throw error;
		};
		// (the callers handle its failure; this one is the flights' own, so it is never unhandled)
		shared.then(undefined, noop);
		work
			.task((s) => attempt(run, input, s, flight, retry))
			.then(
				(answer) => {
					try {
						resolve(landed(answer));
					} catch (error) {
						reject(error);
					}
				},
				(error: unknown) => {
					try {
						resolve(failed(error));
					} catch (thrown) {
						reject(thrown);
					}
				}
			);
		return this._join(key, entry, flight, signal);
	}

	/** A flight's answer landed: kept, or (not kept) the entry goes back to what it kept before. */
	_land(key: unknown, e: Entry, input: I, answer: V, promise: Promise<unknown>): void {
		let ms: number;
		let weight: number;
		try {
			ms = typeof this._keep === 'function' ? this._keep(answer, input) : this._keep;
			weight = this._weigh === undefined ? 1 : this._weigh(answer, input);
		} catch (error) {
			this._back(key, e);
			throw error;
		}
		// (a weight below 0, or not a number, would lower the total and let `max` cap nothing)
		if (!(ms > 0) || !(weight >= 0 && weight <= this._max)) return this._back(key, e);
		// (buggify: an answer not kept, as one too heavy for `max` is: the next caller runs again)
		if (RULES && buggify.fires('flights.not-kept')) return this._back(key, e);
		const at = clock.wall();
		const until = ms === Infinity ? Infinity : clock.mono() + ms; // (a duration: the monotonic clock)
		this._weight += weight - (e.held?.weight ?? 0);
		e.held = { kind: 'kept', answer, at, until, weight, promise };
		this._settle(e);
		// the newest use: the least recently used are first in line to go past `max`
		e.used = ++this._uses;
		this._trim();
	}

	/** The entry's flight is over and what it holds is kept (its flight's work ends). */
	_settle(e: Entry): void {
		const work = e.work;
		e.flight = null;
		e.work = null;
		this._move(e, e.held!);
		if (work !== null) work.close();
	}

	/** The one place an entry moves: told to the observers, and in a rules build refused (thrown)
	 *  when `ENTRY_STEPS` has no such step. The new state first, then what the old one owned ends. */
	_move(e: Entry, to: Entry['now']): void {
		const from = e.now;
		if (RULES && !ENTRY_STEPS[from.kind].includes(to.kind))
			throw machine_error('machine_illegal_move', {
				name: this._name,
				from: from.kind,
				to: to.kind
			});
		e.now = to;
		heard(this._name, from, to, e);
	}

	/** Past `max`: the expired answers go first, then the least recently used (never one kept
	 *  beside a flight out: it stays until the flight lands). */
	_trim(): void {
		if (this._weight <= this._max) return;
		const now = clock.mono();
		for (const [key, e] of this._entries)
			if (e.flight === null && e.held !== null && expired(e.held, now)) this._remove(key, e);
		while (this._weight > this._max) {
			let oldest: Entry | null = null;
			let at: unknown;
			for (const [key, e] of this._entries)
				if (e.flight === null && (oldest === null || e.used < oldest.used)) {
					oldest = e;
					at = key;
				}
			if (oldest === null) return;
			this._remove(at, oldest);
		}
	}

	/** Back to the answer kept before this flight, or gone when there was none. */
	_back(key: unknown, e: Entry): void {
		if (e.held !== null) this._settle(e);
		else this._remove(key, e);
	}

	/** A caller joins `flight`: with no signal, the shared answer; with one, its own stake in it. */
	_join(
		key: unknown,
		e: Entry,
		flight: Flight,
		signal: AbortSignal | undefined
	): Promise<V | Stale> {
		if (signal === undefined) return join(flight, undefined, noop);
		return join(flight, signal, () => {
			if (e.flight === flight) this._back(key, e);
		});
	}

	/** Takes `key`'s entry out: its kept answer goes, its flight (if out) ends. */
	_remove(key: unknown, e: Entry): void {
		if (this._entries.get(key) === e) {
			this._entries.delete(key);
			this._keys?.delete(key);
			if (e.held !== null) this._weight -= e.held.weight;
		}
		if (e.now === GONE_NOW) return;
		const work = e.work;
		e.flight = null;
		e.work = null;
		this._move(e, GONE_NOW);
		if (work !== null) work.close();
	}
}

/** A flights hears its world move (a function of its own: it holds no flights). */
function heard_move(
	f: { _moved(keys: ReadonlySet<unknown> | null): void },
	keys: ReadonlySet<unknown> | null
): void {
	f._moved(keys);
}

/** Makes a keyed flights over input `I` (`flights.keyed<I>()({ key, ignore?, run, … })`). */
export type KeyedFlights<I> = <
	const F extends keyof I,
	G extends Exclude<keyof I, F> = never,
	V = unknown,
	W = never
>(
	options: KeyedFlightsOptions<I, F, G, V, W>
) => Flights<I, Fresh<Awaited<V>>, Pick<I, F>>;

function make_flights<I = void, V = unknown, W = never>(
	options: FlightsOptions<I, V, W>
): Flights<I, Fresh<Awaited<V>>, I> {
	return new Flown(options as FlightsOptions<unknown, unknown, unknown>) as never;
}

/** Keyed shared async work (see the module's comment). `flights.keyed<I>()` is its keyed form: a
 *  maker of a flights over object input `I` keyed by some of its fields,
 *  `flights.keyed<Ask>()({ key: ['href'], run })`. */
export const flights: {
	<I = void, V = unknown, W = never>(
		options: FlightsOptions<I, V, W>
	): Flights<I, Fresh<Awaited<V>>, I>;
	keyed<I extends object>(): KeyedFlights<I>;
} = /* @__PURE__ */ Object.assign(make_flights, {
	keyed: <I extends object>(): KeyedFlights<I> => keyed as KeyedFlights<I>
});

function keyed(options: KeyedFlightsOptions<object, never, never, unknown>): unknown {
	if (typeof options !== 'object' || options === null || options.key === undefined)
		throw bad_option('key', 'none', 'the input fields that make the key');
	return new Flown(options);
}
