/**
 * What `flights()` adds to the flights every maker makes (./flights.ts): a key of two fields or
 * more, spelled into one string; a `world` its answers are made in (and `touches`); a `weigh`.
 * Its own module, so a page whose flights need none of these (`plain_flights`) carries none of it.
 */
import { Flown, makers, type FlightsOptions, type Makers } from './flights.ts';
import type { Flight } from './flight.ts';
import type { Watched } from './world.ts';

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

/** The flights `flights()` makes (see ./flights.ts and its module comment). */
class Full<I, V, K> extends Flown<I, V, K> {
	_touches: ((answer: V) => Iterable<unknown>) | undefined;

	constructor(o: FlightsOptions<I, unknown, unknown> & { key?: readonly PropertyKey[] }) {
		super(o as never);
		this._weigh = o.weigh as ((answer: V, input: I) => number) | undefined;
		this._world = o.world;
		this._touches = o.touches as ((answer: V) => Iterable<unknown>) | undefined;
		// (heard for itself, held weakly: a flights nobody holds is collected, its world forgets it)
		if (o.world !== undefined)
			this._unwatch = (o.world as Watched<unknown>)._watch!(this, heard_move);
	}

	/** A keyed flights' key of no field or of two or more: its key fields, in their order,
	 *  spelled one way. */
	override _spell(fields: readonly PropertyKey[], input: unknown): unknown {
		const of = input as Record<PropertyKey, unknown>;
		let key = '';
		for (const f of fields) key += key_part(of[f]);
		return key;
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
	override _current(flight: Flight, answer: V): boolean {
		const w = this._world;
		if (w === undefined) return true;
		const touches = this._touches;
		return touches === undefined ? w.fresh(flight.stamp) : w.fresh(flight.stamp, touches(answer));
	}
}

/** A flights hears its world move (a function of its own: it holds no flights). */
function heard_move(
	f: { _moved(keys: ReadonlySet<unknown> | null): void },
	keys: ReadonlySet<unknown> | null
): void {
	f._moved(keys);
}

/** Keyed shared async work (see ./flights.ts's comment). `flights.keyed<I>()` is its keyed form:
 *  a maker of a flights over object input `I` keyed by some of its fields,
 *  `flights.keyed<Ask>()({ key: ['href'], run })`. */
export const flights: Makers<{}, 'any'> = /* @__PURE__ */ makers<{}, 'any'>(
	(options) => new Full(options as FlightsOptions<unknown, unknown, unknown>)
);
