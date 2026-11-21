/**
 * @internal A cache of at most `max` values, the least recently used first out: `cache()` with
 * none of `keep`, `weigh`, `onEvict`, `pinned` or `world`, for ogygia's own runtime. Each value
 * weighs 1 and stays until `max` or its owner lets it go, so it carries no ages, weights, timer
 * or notices. It behaves as `cache()` does with those options (test: lru.test.ts).
 *
 * @packageDocumentation
 */
import { DEV } from 'esm-env';
import { refused_max } from './cache.ts';
import { machine_error, report } from './messages.ts';
import { DISPOSE, Life, type Scope } from './scope.ts';

export interface LruOptions {
	/** Names the cache, as `cache()`'s does. */
	name?: string;
	/** The most values it keeps: a finite number more than 0 (its whole part; under 1 keeps
	 *  none), refused as `cache()` refuses it. */
	max: number;
	/** The scope it lives in: when it ends, the cache ends. */
	owner?: Scope | Life;
}

/** A cache as {@link lru} makes it: `Cache` without set options (it has no ages or world). */
export interface Lru<K, V> {
	/** The value for `key`, as a use (it becomes the most recently used). */
	get(key: K): V | undefined;
	/** The value for `key`, without counting as a use. */
	peek(key: K): V | undefined;
	/** `key` holds a value. */
	has(key: K): boolean;
	/** Keeps `value` for `key`, the least recently used going when it is full: `false` when it
	 *  ended (or keeps none). */
	set(key: K, value: V): boolean;
	/** Lets `key` go: whether it held a value. */
	delete(key: K): boolean;
	/** Lets every value go. */
	clear(): void;
	/** The values, least recently used first (not a use). */
	entries(): Array<[K, V]>;
	/** How many values it holds. */
	readonly size: number;
	/** Ends it: nothing kept after. */
	[Symbol.dispose](): void;
}

const NO_KEY = {};

class Bounded<K, V> implements Lru<K, V> {
	#held = new Map<K, V>();
	#newest: unknown = NO_KEY;
	#newest_value: V | undefined = undefined;
	#room: number;
	#life: Life;

	constructor(o: LruOptions, refused: boolean) {
		this.#room = Math.floor(o.max);
		const l = (this.#life = o.owner === undefined ? new Life() : (o.owner as Life).child());
		l.defer(() => this.clear());
		if (refused) l.close();
	}

	get size(): number {
		return this.#held.size;
	}

	get(key: K): V | undefined {
		const held = this.#held;
		if (key === this.#newest) return this.#newest_value;
		const value = held.get(key);
		if (value === undefined && !held.has(key)) return undefined;
		held.delete(key);
		held.set(key, value as V);
		this.#newest = key;
		this.#newest_value = value;
		return value;
	}

	peek(key: K): V | undefined {
		return this.#held.get(key);
	}

	has(key: K): boolean {
		return this.#held.has(key);
	}

	set(key: K, value: V): boolean {
		if (this.#life.closed) return false;
		const held = this.#held;
		if (key === this.#newest) {
			held.set(key, value);
			this.#newest_value = value;
			return true;
		}
		if (!held.delete(key) && held.size >= this.#room) {
			if (held.size === 0) return false;
			held.delete(held.keys().next().value as K);
		}
		held.set(key, value);
		this.#newest = key;
		this.#newest_value = value;
		return true;
	}

	delete(key: K): boolean {
		if (key === this.#newest) this.#forget();
		return this.#held.delete(key);
	}

	clear(): void {
		this.#held.clear();
		this.#forget();
	}

	#forget(): void {
		this.#newest = NO_KEY;
		this.#newest_value = undefined;
	}

	entries(): Array<[K, V]> {
		return [...this.#held];
	}

	[DISPOSE](): void {
		this.#life.close();
	}
}

/** @internal A bounded cache of `max` values, least recently used out first (see the module): its
 *  max refused as `cache()` refuses it. The build checks a call's options and makes it
 *  {@link trusted_lru} (internal/macros options pass). */
export function lru<K, V>(o: LruOptions): Lru<K, V> {
	const refused = refused_max(o as { max: number });
	if (refused !== null) {
		if (DEV) throw machine_error('machine_bad_option', refused);
		report('machine_bad_option', refused);
	}
	return new Bounded<K, V>(o, refused !== null);
}

/** @internal {@link lru} for options its caller's build checked (`check_cache`, run on a literal). */
export function trusted_lru<K, V>(o: LruOptions): Lru<K, V> {
	return new Bounded<K, V>(o, false);
}
