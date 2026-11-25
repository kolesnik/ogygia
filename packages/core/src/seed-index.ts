/**
 * THE SEED INDEX — the server's half of seed references (./seed-refs.ts has the design): the
 * seed's `page.data` indexed by identity and by structure, and each island's plan against it (which
 * of its props nodes cross as references). Only the page seed's step reaches it
 * (server/document-seeds.ts), so a server that never ships a page seed never carries it.
 *
 * ONE WALK: the index is the request memo's walk of the seed (seed-refs.ts `measure` with this
 * index as its recorder): each node is measured once, and the same pass records where each node at
 * or above `min_bytes` sits and which byte bucket it falls in. When the walk ends the index
 * publishes its buckets on the memo, so every props root measured after it knows which of its nodes
 * may reach the seed (F_SEED), and a plan never walks props that cannot hold a reference.
 *
 * @packageDocumentation
 */
import type { SeedPath } from './seed-ref-reviver.ts';
import {
	analysis,
	bytes_of,
	F_REF,
	F_SEED,
	is_plain,
	measure,
	memo_for,
	SEED_MIN_BYTES,
	type MeasureMemo,
	type SeedRecorder
} from './seed-refs.ts';

/** Leaves that a plain deep copy reproduces exactly. */
function is_leaf(v: unknown): boolean {
	return (
		v === null ||
		v === undefined ||
		typeof v === 'string' ||
		typeof v === 'number' ||
		typeof v === 'boolean' ||
		typeof v === 'bigint' ||
		v instanceof Date
	);
}

const leaf_text = (v: unknown): string => {
	if (v === undefined) return 'u';
	if (v === null) return 'n';
	return v instanceof Date ? `d${v.getTime()}` : `${typeof v}:${String(v)}`;
};

const F64 = new Float64Array(1);
const F64_WORDS = new Uint32Array(F64.buffer);
const mix = (h: number, x: number): number => Math.imul(h ^ x, 0x01000193) >>> 0;

function text_hash(s: string): number {
	const n = s.length;
	// oxlint-disable-next-line ogygia/one-hash -- samples a long string at eight places where bucket32 reads every character (the clone match's cost); a hit is only a candidate, same_structure decides
	let h = mix(0x811c9dc5, n);
	if (n <= 16) {
		for (let i = 0; i < n; i++) h = mix(h, s.charCodeAt(i));
		return h;
	}
	for (let i = 0; i < 8; i++) h = mix(h, s.charCodeAt(Math.floor(((n - 1) * i) / 7)));
	return h;
}

function number_hash(n: number): number {
	F64[0] = n === 0 ? 0 : n;
	return mix(F64_WORDS[0]!, F64_WORDS[1]!);
}

const NAN_HASH = number_hash(NaN);

/**
 * Structural hashes: equal for plain subtrees of one structure class — what a plain deep copy
 * makes alike (keys in any order, a number by its text, a Date by its time, an empty slot as
 * `undefined`). Cheap on purpose: a long string is sampled, never read whole, so a hit is only a
 * candidate and {@link same_structure} decides. `-1`: not referenceable (a value no copy
 * reproduces, or a cycle). Memoised per node.
 */
export class StructureHashes {
	readonly #of = new Map<object, number>();
	readonly #on_stack = new Set<object>();

	/** The structural hash of `v`, `-1` when it is not referenceable. */
	of(v: unknown): number {
		switch (typeof v) {
			case 'string':
				return mix(1, text_hash(v));
			case 'number':
				return mix(2, Number.isNaN(v) ? NAN_HASH : number_hash(v));
			case 'boolean':
				return v ? 3 : 4;
			case 'undefined':
				return 6;
			case 'bigint':
				return mix(7, text_hash(String(v)));
			case 'object':
				break;
			default:
				return -1;
		}
		if (v === null) return 5;
		if (v instanceof Date) {
			const t = v.getTime();
			return mix(8, Number.isNaN(t) ? NAN_HASH : number_hash(t));
		}
		if (!is_plain(v)) return -1;
		const cached = this.#of.get(v);
		if (cached !== undefined) return cached;
		if (this.#on_stack.has(v)) return -1;
		this.#on_stack.add(v);
		const h = Array.isArray(v) ? this.#array_hash(v) : this.#object_hash(v);
		this.#on_stack.delete(v);
		this.#of.set(v, h);
		return h;
	}

	#array_hash(v: unknown[]): number {
		let h = mix(9, v.length);
		for (let i = 0; i < v.length; i++) {
			const c = this.of(v[i]);
			if (c === -1) return -1;
			h = mix(h, c);
		}
		return h;
	}

	#object_hash(v: Record<string, unknown>): number {
		let sum = 0;
		let count = 0;
		for (const key of Object.keys(v)) {
			const c = this.of(v[key]);
			if (c === -1) return -1;
			sum = (sum + mix(text_hash(key), c)) >>> 0;
			count++;
		}
		return mix(mix(10, count), sum);
	}
}

/**
 * Whether two values are of one structure class (see {@link StructureHashes}): the same leaves by
 * their text, the same keys, the same lengths. For referenceable values only (no cycle inside).
 */
export function same_structure(a: unknown, b: unknown): boolean {
	if (typeof a === 'string' || typeof b === 'string') return a === b;
	if (is_leaf(a) || is_leaf(b)) return is_leaf(a) && is_leaf(b) && leaf_text(a) === leaf_text(b);
	if (!is_plain(a) || !is_plain(b) || Array.isArray(a) !== Array.isArray(b)) return false;
	if (a === b) return true;
	if (Array.isArray(a)) {
		const bs = b as unknown[];
		if (a.length !== bs.length) return false;
		for (let i = 0; i < a.length; i++) if (!same_structure(a[i], bs[i])) return false;
		return true;
	}
	const bo = b as Record<string, unknown>;
	const keys = Object.keys(a);
	if (keys.length !== Object.keys(bo).length) return false;
	for (const k of keys)
		if (!Object.hasOwn(bo, k) || !same_structure((a as Record<string, unknown>)[k], bo[k]))
			return false;
	return true;
}

/** Exact structural equality for the shapes `StructureHashes` accepts — the check behind a hit. */
export function deep_equal_plain(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) return true;
	if (a instanceof Date || b instanceof Date)
		return a instanceof Date && b instanceof Date && a.getTime() === b.getTime();
	if (is_leaf(a) || is_leaf(b)) return false;
	if (!is_plain(a) || !is_plain(b)) return false;
	if (Array.isArray(a) !== Array.isArray(b)) return false;
	if (Array.isArray(a) && Array.isArray(b)) {
		if (a.length !== b.length) return false;
		for (let i = 0; i < a.length; i++)
			if (i in a !== i in b || !deep_equal_plain(a[i], b[i])) return false;
		return true;
	}
	const ka = Object.keys(a as object);
	const kb = Object.keys(b as object);
	if (ka.length !== kb.length) return false;
	for (const k of ka) {
		if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
		if (!deep_equal_plain((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k]))
			return false;
	}
	return true;
}

interface Place {
	readonly node: object;
	readonly parent: object | null;
	readonly key: string | number;
	readonly ref: boolean;
	path: SeedPath | null;
	next: Place | null;
}

const EMPTY_NODES: readonly object[] = [];

const index_cache = new WeakMap<object, SeedIndex>();

/**
 * The seed's `data` indexed for referencing: every referenceable node at or above `min_bytes`, by
 * identity and by structure (first occurrence wins — the shortest path is not guaranteed, the first
 * in key order is, which is deterministic). Built by the seed's one walk (see the module doc); a
 * node the memo measured before the walk (a root measured before the page was known) is descended
 * for its place only, so the index is the same whichever root was measured first. Data that is not
 * a plain object or array indexes nothing.
 */
export class SeedIndex implements SeedRecorder {
	/** nodes indexed (for tests / devtools). */
	readonly size: number;
	/**
	 * SEED SHAPING: the top-level `page.data` keys under which a props node was matched
	 * (`plan` records the first path segment of every reference it plans). The handle renders the
	 * tail against the FULL index, then ships every touched key — a key no island's code reads but
	 * whose node an island's props point into still ships, so a reference always has something to
	 * point at.
	 */
	readonly touched: Set<string> = new Set();
	/** The smallest node indexed, in bytes. */
	readonly min: number;
	#memo: MeasureMemo | null = null;
	readonly #at = new Map<object, Place>();
	#count = 0;
	/** Size buckets for structure matching: each byte estimate's referenceable nodes, in the walk's
	 *  order, as a chain of their places (no array grows with a bucket). */
	readonly #buckets = new Map<number, { first: Place; last: Place }>();
	readonly #hashes = new StructureHashes();
	/** Per size bucket: the first of its places not hashed yet (in bucket order), and each hash's
	 *  nodes. */
	readonly #by_hash = new Map<number, { next: Place | null; nodes: Map<number, object[]> }>();

	/** The index of `data`, cached per `data` object: one index per request, however many islands
	 *  ask. `memo`: the request's measure memo, when the caller holds it (seed-refs.ts `analysis`). */
	static of(data: unknown, memo?: MeasureMemo, min_bytes: number = SEED_MIN_BYTES): SeedIndex {
		if (!is_plain(data)) return new SeedIndex(data, min_bytes, memo);
		let index = index_cache.get(data);
		if (!index) index_cache.set(data, (index = new SeedIndex(data, min_bytes, memo)));
		return index;
	}

	constructor(data: unknown, min_bytes: number, request_memo?: MeasureMemo) {
		this.min = min_bytes;
		if (is_plain(data)) {
			const memo = (this.#memo = memo_for(data, request_memo));
			analysis(data, memo, this);
			if (!this.#at.has(data) && this.#enters(data, memo.nodes))
				this.#descend(data, null, '', memo.nodes);
			if (memo.seed === null && min_bytes === SEED_MIN_BYTES) {
				memo.seed = this;
				memo.seed_sizes = this.#buckets;
			}
		}
		this.size = this.#count;
	}

	/** The seed's walk met a node it measured: it sits under `parent` at `key`. */
	measured(v: object, parent: object | null, key: string | number, p: number): void {
		this.#place(v, parent, key, p);
	}

	/** The seed's walk met a node the memo measured before: it and its subtree sit here, unless
	 *  the walk placed them already. */
	known(v: object, parent: object | null, key: string | number): void {
		if (!this.#at.has(v)) this.#descend(v, parent, key, this.#memo!.nodes);
	}

	#place(v: object, parent: object | null, key: string | number, p: number): void {
		const ref = (p & F_REF) !== 0;
		const at: Place = { node: v, parent, key, ref, path: parent === null ? [] : null, next: null };
		this.#at.set(v, at);
		if (!ref) return;
		this.#count++;
		const b = bytes_of(p);
		const bucket = this.#buckets.get(b);
		if (bucket === undefined) this.#buckets.set(b, { first: at, last: at });
		else bucket.last = bucket.last.next = at;
	}

	#descend(
		v: object,
		parent: object | null,
		key: string | number,
		nodes: Map<object, number>
	): void {
		this.#place(v, parent, key, nodes.get(v)!);
		if (Array.isArray(v)) {
			for (let i = 0; i < v.length; i++) {
				const c: unknown = v[i];
				if (this.#enters(c, nodes)) this.#descend(c, v, i, nodes);
			}
		} else {
			for (const k in v) {
				const c = (v as Record<string, unknown>)[k];
				if (this.#enters(c, nodes)) this.#descend(c, v, k, nodes);
			}
		}
	}

	#enters(c: unknown, nodes: Map<object, number>): c is object {
		if (!is_plain(c) || this.#at.has(c)) return false;
		const p = nodes.get(c);
		return p !== undefined && bytes_of(p) >= this.min;
	}

	#path_of(at: Place): SeedPath {
		if (at.path !== null) return at.path;
		const path = [...this.#path_of(this.#at.get(at.parent!)!), at.key];
		at.path = path;
		return path;
	}

	/**
	 * One island's references, the plan of `props` against this index (the props wire asks it here,
	 * so a server that never ships a seed never carries the plan): walk the props once, top-down,
	 * largest matching ancestor first — identity first (a pointer lookup per node), then structure
	 * (an id and an exact comparison, only for a large plain node the seed does not own, and only
	 * against the seed nodes of exactly the same byte size — usually none, or one). Nodes under a
	 * matched ancestor are never visited (they ride inside the reference), and neither is anything
	 * under a node below `min_bytes` or a node the memo says cannot reach the seed (no F_SEED, when
	 * the props were measured after this index's walk). The props' own measures come from the
	 * request memo, so the plan adds no walk of its own beyond the pointer lookups.
	 * @heisenbench linear in props
	 */
	plan(props: unknown, min_bytes: number = SEED_MIN_BYTES): SeedRefPlan {
		const matched = new WeakMap<object, SeedPath>();
		const keys = new Set<string>();
		let count = 0;
		if (this.size > 0) {
			const memo = analysis(props, this.#memo ?? undefined).memo;
			const nodes = memo.nodes;
			const prune = memo === this.#memo && memo.seed === this && min_bytes === SEED_MIN_BYTES;
			const seen = new Set<object>();
			const hit = (v: object, path: SeedPath) => {
				matched.set(v, path);
				this.touched.add(String(path[0]));
				keys.add(String(path[0]));
				count++;
			};
			const visit = (v: unknown) => {
				if (!is_plain(v) || seen.has(v)) return;
				seen.add(v);
				const by_id = this.path(v);
				if (by_id) return hit(v, by_id);
				const p = nodes.get(v) ?? measure(v, memo);
				const bytes = bytes_of(p);
				if (bytes < min_bytes || (prune && (p & F_SEED) === 0)) return;
				if (p & F_REF && this.#buckets.has(bytes)) {
					const cand = this.match(bytes, v);
					if (cand && deep_equal_plain(cand, v)) return hit(v, this.path(cand)!);
				}
				if (Array.isArray(v)) for (const item of v) visit(item);
				else for (const key in v) visit((v as Record<string, unknown>)[key]);
			};
			visit(props);
		}
		return {
			reducer: (value) =>
				value === null || typeof value !== 'object' ? undefined : matched.get(value),
			count,
			keys
		};
	}

	/** node → its path from `page.data` (identity matches: the app passed the seed's own object).
	 *  The path is materialised on the first ask — an indexed node that no island references
	 *  never allocates one. */
	path(node: object): SeedPath | undefined {
		const here = this.#at.get(node);
		return here === undefined || !here.ref ? undefined : this.#path_of(here);
	}

	/** Whether `node` is an indexed seed node (by identity). */
	has(node: object): boolean {
		return this.#at.get(node)?.ref === true;
	}

	/** The seed nodes with exactly this byte estimate — the only ones a props node of that size can
	 *  be a clone of, in the walk's order. */
	candidates(bytes: number): readonly object[] {
		const out: object[] = [];
		for (let at = this.#buckets.get(bytes)?.first ?? null; at !== null; at = at.next)
			out.push(at.node);
		return out;
	}

	/**
	 * The first seed node of exactly this byte estimate that is of `v`'s structure class (bucket
	 * order, as `candidates(bytes).find(...)` gives it). The bucket is hashed in order only as far as
	 * an ask needs, each hash keeping its nodes in order, so the many same-sized records of a list
	 * cost one hash each however many props nodes ask, and a hit is checked against the few nodes
	 * of its hash.
	 */
	match(bytes: number, v: object): object | undefined {
		const bucket = this.#buckets.get(bytes);
		if (bucket === undefined) return undefined;
		const h = this.#hashes.of(v);
		if (h === -1) return undefined;
		let at = this.#by_hash.get(bytes);
		if (at === undefined) this.#by_hash.set(bytes, (at = { next: bucket.first, nodes: new Map() }));
		for (const node of at.nodes.get(h) ?? EMPTY_NODES) if (same_structure(node, v)) return node;
		while (at.next !== null) {
			const node = at.next.node;
			at.next = at.next.next;
			const own = this.#hashes.of(node);
			if (own === -1) continue;
			const same = at.nodes.get(own);
			if (same) same.push(node);
			else at.nodes.set(own, [node]);
			if (own === h && same_structure(node, v)) return node;
		}
		return undefined;
	}
}

/** One island's references: {@link SeedIndex.plan}. */
export interface SeedRefPlan {
	/** The devalue reducer for the `OgygiaSeedRef` type: `(value) => path | undefined`. */
	readonly reducer: (value: unknown) => SeedPath | undefined;
	/** How many props nodes will cross as references (0 = serialize the canonical text instead). */
	readonly count: number;
	/** The top-level `page.data` keys the references point into (this island's share of `touched`). */
	readonly keys: Set<string>;
}
