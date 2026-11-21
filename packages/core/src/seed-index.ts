/**
 * THE SEED INDEX — the server's half of seed references (./seed-refs.ts has the design): the
 * seed's `page.data` indexed by identity and by structure, and each island's plan against it (which
 * of its props nodes cross as references). Only the page seed's step reaches it
 * (server/document-seeds.ts), so a server that never ships a page seed never carries it.
 *
 * @packageDocumentation
 */
import { fnv1a } from './contract/hash.ts';
import type { SeedPath } from './seed-ref-reviver.ts';
import { analysis, bytes_of, F_REF, is_plain, measure, type MeasureMemo } from './seed-refs.ts';

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

/**
 * Post-order structural hash + byte estimate of a plain subtree. `null` when the subtree is not
 * referenceable (a non-plain value inside, or a cycle). Visits each node once per walk; results
 * are memoised in `memo` so a graph with shared nodes stays linear.
 */
function hash_subtree(
	v: unknown,
	memo: Map<object, { hash: string; bytes: number } | null>,
	on_stack: Set<object>
): { hash: string; bytes: number } | null {
	if (is_leaf(v)) {
		const t = leaf_text(v);
		return { hash: t, bytes: t.length };
	}
	if (!is_plain(v)) return null;
	const cached = memo.get(v);
	if (cached !== undefined) return cached;
	if (on_stack.has(v)) return null; // cycle
	on_stack.add(v);
	let bytes = 0;
	const acc = [Array.isArray(v) ? 'A' : 'O'];
	let ok = true;
	if (Array.isArray(v)) {
		for (const item of v) {
			const h = hash_subtree(item, memo, on_stack);
			if (!h) {
				ok = false;
				break;
			}
			acc.push(h.hash);
			bytes += h.bytes + 1;
		}
	} else {
		for (const key of Object.keys(v).sort()) {
			const h = hash_subtree((v as Record<string, unknown>)[key], memo, on_stack);
			if (!h) {
				ok = false;
				break;
			}
			acc.push(`${key}=${h.hash}`);
			bytes += key.length + h.bytes + 3;
		}
	}
	on_stack.delete(v);
	// hash the accumulated child hashes (bounded per node — children contribute 16 chars each)
	const result = ok ? { hash: fnv1a(acc.join('|')), bytes } : null;
	memo.set(v, result);
	return result;
}

/** Exact structural equality for the shapes `hash_subtree` accepts — the check behind a hash hit. */
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

/** Where an indexed seed node sits: its parent's node and the key under it. The path array is
 *  materialised only when a reference is actually planned to this node. */
interface PathNode {
	parent: PathNode | null;
	key: string | number;
	path: SeedPath | null;
}

function path_of(at: PathNode): SeedPath {
	if (at.path !== null) return at.path;
	const path = at.parent === null ? [] : [...path_of(at.parent), at.key];
	at.path = path;
	return path;
}

const EMPTY_NODES: readonly object[] = [];

const index_cache = new WeakMap<object, SeedIndex>();

/**
 * The seed's `data` indexed for referencing: every referenceable node at or above `min_bytes`, by
 * identity now and by structural hash on demand (first occurrence wins — the shortest path is not
 * guaranteed, the first in key order is, which is deterministic). It reads the one measuring walk
 * (`analyze`) and prunes: a node below `min_bytes` cannot hold a child at or above it (a child is
 * never larger than its parent), so its subtree is skipped BEFORE anything is materialised — on a
 * CMS tree that is most of the nodes. Data that is not a plain object or array indexes nothing.
 */
export class SeedIndex {
	/** nodes indexed (for tests / devtools). */
	readonly size: number;
	/**
	 * SEED SHAPING: the top-level `page.data` keys under which a props node was matched
	 * (`plan_seed_refs` records the first path segment of every reference it plans). The handle
	 * renders the tail against the FULL index, then ships every touched key — a key no island's
	 * code reads but whose node an island's props point into still ships, so a reference always
	 * has something to point at.
	 */
	readonly touched: Set<string> = new Set();
	#memo: MeasureMemo | null = null;
	#at = new WeakMap<object, PathNode>();
	#nodes: object[] = [];
	// Size buckets for structure matching, built on the first ask; hashes memoised per seed node.
	#by_bytes: Map<number, object[]> | null = null;
	#hash_memo = new Map<object, { hash: string; bytes: number } | null>();
	// Per size bucket: how many of its nodes are hashed (in bucket order), and each hash's first node.
	#by_hash = new Map<number, { hashed: number; first: Map<string, object> }>();

	/** The index of `data`, cached per `data` object: one index per request, however many islands
	 *  ask. */
	static of(data: unknown, min_bytes = 96): SeedIndex {
		if (!is_plain(data)) return new SeedIndex(data, min_bytes);
		let index = index_cache.get(data);
		if (!index) index_cache.set(data, (index = new SeedIndex(data, min_bytes)));
		return index;
	}

	/** The plan of `props` against this index: which of its nodes cross as references. (The props
	 *  wire asks it here, so a server that never ships a seed never carries the plan.) */
	plan(props: unknown): SeedRefPlan {
		return new SeedRefPlan(this, props);
	}

	constructor(data: unknown, min_bytes: number) {
		if (is_plain(data)) {
			const memo = (this.#memo = analysis(data).memo);
			const at = this.#at;
			const nodes = this.#nodes;
			const seen = new Set<object>();
			// Enter a child when it is plain, unseen, measured, and big enough to hold a referenceable node.
			const enter = (c: unknown): c is Record<string, unknown> | unknown[] => {
				if (!is_plain(c) || seen.has(c)) return false;
				const p = memo.get(c);
				return p !== undefined && bytes_of(p) >= min_bytes;
			};
			const visit = (v: Record<string, unknown> | unknown[], here: PathNode) => {
				seen.add(v);
				if (memo.get(v)! & F_REF) {
					at.set(v, here);
					nodes.push(v);
				}
				if (Array.isArray(v)) {
					for (let i = 0; i < v.length; i++) {
						const c = v[i];
						if (enter(c)) visit(c, { parent: here, key: i, path: null });
					}
				} else {
					for (const key in v) {
						const c = v[key];
						if (enter(c)) visit(c, { parent: here, key, path: null });
					}
				}
			};
			if (enter(data)) visit(data, { parent: null, key: '', path: [] });
		}
		this.size = this.#nodes.length;
	}

	/** node → its path from `page.data` (identity matches: the app passed the seed's own object).
	 *  The path is materialised on the first ask — an indexed node that no island references
	 *  never allocates one. */
	path(node: object): SeedPath | undefined {
		const here = this.#at.get(node);
		return here === undefined ? undefined : path_of(here);
	}

	/** Whether `node` is an indexed seed node (by identity). */
	has(node: object): boolean {
		return this.#at.has(node);
	}

	/**
	 * The seed nodes with exactly this byte estimate — the only ones a props node of that size can
	 * be a clone of. Structure matching hashes just those few candidates (memoised per seed node)
	 * instead of the whole seed, so an app that passes the seed's own objects never hashes a seed
	 * node at all, and a cloning app hashes only what it has to. The buckets are built on the first
	 * ask — a page whose islands only pass seed objects by identity never builds them.
	 */
	candidates(bytes: number): readonly object[] {
		if (this.#by_bytes === null) {
			const by_bytes = (this.#by_bytes = new Map());
			for (const n of this.#nodes) {
				const b = bytes_of(this.#memo!.get(n)!);
				const bucket = by_bytes.get(b);
				if (bucket) bucket.push(n);
				else by_bytes.set(b, [n]);
			}
		}
		return this.#by_bytes.get(bytes) ?? EMPTY_NODES;
	}

	/**
	 * The first seed node of exactly this byte estimate whose structural hash is `hash` (bucket
	 * order, as `candidates(bytes).find(...)` gives it), in one map lookup. The bucket is hashed in
	 * order only as far as an ask needs, each hash keeping its first node, so the many same-sized
	 * records of a list cost one hash each however many props nodes ask.
	 */
	match(bytes: number, hash: string): object | undefined {
		const bucket = this.candidates(bytes);
		if (bucket.length === 0) return undefined;
		let at = this.#by_hash.get(bytes);
		if (at === undefined) this.#by_hash.set(bytes, (at = { hashed: 0, first: new Map() }));
		const hit = at.first.get(hash);
		if (hit !== undefined) return hit;
		while (at.hashed < bucket.length) {
			const node = bucket[at.hashed++];
			const h = this.hash_of(node);
			if (h === null || at.first.has(h)) continue;
			at.first.set(h, node);
			if (h === hash) return node;
		}
		return undefined;
	}

	/** Structural hash of an indexed seed node, memoised for the request. */
	hash_of(node: object): string | null {
		return this.#memo === null
			? null
			: (hash_subtree(node, this.#hash_memo, new Set())?.hash ?? null);
	}
}

/**
 * One island's references: walk the props once, top-down, largest matching ancestor first —
 * identity first (a pointer lookup per node, no hashing), then structure (hash + exact comparison,
 * only for a large plain node the seed does not own, and only against the seed nodes of exactly the
 * same byte size — usually none, or one). Nodes under a matched ancestor are never visited (they
 * ride inside the reference), and neither is anything under a node below `min_bytes` (no child
 * of it can be referenced). The props' own measures come from the request memo, so the plan adds
 * no walk of its own beyond the pointer lookups.
 * @heisenbench linear in props
 */
export class SeedRefPlan {
	/** The devalue reducer for the `OgygiaSeedRef` type: `(value) => path | undefined`. */
	readonly reducer: (value: unknown) => SeedPath | undefined;
	/** How many props nodes will cross as references (0 = serialize the canonical text instead). */
	readonly count: number;
	/** The top-level `page.data` keys the references point into (this island's share of `touched`). */
	readonly keys: Set<string> = new Set();

	constructor(index: SeedIndex, props: unknown, min_bytes = 96) {
		const matched = new WeakMap<object, SeedPath>();
		const keys = this.keys;
		let count = 0;
		if (index.size > 0) {
			const memo = analysis(props).memo;
			const hashed = new Map<object, { hash: string; bytes: number } | null>();
			const seen = new Set<object>();
			const hit = (v: object, path: SeedPath) => {
				matched.set(v, path);
				index.touched.add(String(path[0]));
				keys.add(String(path[0]));
				count++;
			};
			const visit = (v: unknown) => {
				if (!is_plain(v) || seen.has(v)) return;
				seen.add(v);
				const by_id = index.path(v);
				if (by_id) return hit(v, by_id);
				const p = memo.get(v) ?? measure(v, memo);
				const bytes = bytes_of(p);
				if (bytes < min_bytes) return;
				if (p & F_REF && index.candidates(bytes).length) {
					const h = hash_subtree(v, hashed, new Set())?.hash ?? null;
					const cand = h ? index.match(bytes, h) : undefined;
					if (cand && deep_equal_plain(cand, v)) return hit(v, index.path(cand)!);
				}
				if (Array.isArray(v)) for (const item of v) visit(item);
				else for (const key in v) visit((v as Record<string, unknown>)[key]);
			};
			visit(props);
		}
		this.count = count;
		this.reducer = (value) =>
			value === null || typeof value !== 'object' ? undefined : matched.get(value);
	}
}
