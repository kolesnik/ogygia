/**
 * SEED REFERENCES — island props that point into the page seed instead of copying it.
 *
 * THE DUPLICATION: on a csr=false page the handle ships `page.data` once as the page seed (so
 * islands can read `$page`), and every island ships its props as its own sidecar. A CMS page hands
 * each block island its slice of the same `page.data` tree, so the same JSON crosses twice —
 * measured on one landing page: 674 KB of seed and 481 KB of props, of which 94% were verbatim
 * seed subtrees. Twice the bytes, and twice the server-side serialization (the larger part of that
 * page's remaining TTFB gap to a plain Kit render).
 *
 * THE CODEC: when the seed ships, an island's props are serialized RELATIVE to it. Any plain
 * object / array in the props that is also a node of `page.data` — by IDENTITY (the app passed the
 * same object) or by STRUCTURE (the app cloned it: a JSON round-trip, a spread — CMS SDKs do) — is
 * written as `["OgygiaSeedRef", <path>]`, a path from `page.data` to that node. The client revives
 * the reference against the ONE parsed seed of its document (the same graph `page.data` reads —
 * `runtime/seeds.ts`) and hands the island the seed's own node, by reference: island props are a
 * snapshot either way, and the DEV mutation guard warns on a write into them. Largest matching
 * ancestor wins, so a block whose whole props object is one seed node becomes one short reference.
 *
 * WHAT MATCHES: plain objects and arrays whose subtree holds only plain objects, arrays, primitives
 * and Dates — no class instances (wired values, stores, snippets keep their own codec), no Maps or
 * Sets, no cycles. Small nodes are skipped (`min_bytes`): a reference costs ~30 bytes, so it must
 * save more than that.
 *
 * WHEN: only inside Kit's page pass of THIS document, and only when the seed ships — a reference
 * into a seed that never arrives would be a hole in the island's props. The decision is made ONCE
 * per request, when the document tail renders (server/props-wire.ts): every island on the page
 * gets references then, whichever rendered first. Every other render root (a hole endpoint, a
 * baked ticket, a foreign fragment) never references: its props must be self-contained wherever
 * the HTML is spliced.
 *
 * ONE WALK PER NODE PER REQUEST: `measure` visits a node once and remembers what it learned —
 * byte estimate, referenceability, JSON-exactness, a streamed promise inside — as ONE NUMBER in a
 * memo shared by every root measured in the same request (`set_measure_memo_reader`; the handle
 * hands out its request's memo). The seed's `page.data` is walked once; the twenty block islands
 * whose props ARE seed nodes cost a lookup each, not a walk each; the shaped seed, the props plans
 * and the handle's lane / streaming decisions all read the same memo. Nothing is allocated per
 * node beyond the memo entry: no measure object, no cycle stack (the memo's in-progress mark is
 * the cycle detector), no path array until a node is actually referenced.
 *
 * Universal module (no Node imports): the walk runs on both legs, the index + reducer on the server
 * (./seed-index.ts, reached only from the page seed's step), the resolver on the client, and the
 * unit tests exercise both ends against a real devalue round trip.
 */

// The client half (tag + reviver) is a leaf of its own: seed-ref-reviver.ts says why.
export {
	SEED_REF_KEY,
	resolve_seed_ref,
	seed_ref_reviver,
	type SeedPath
} from './seed-ref-reviver.ts';

/** A node the codec may reference: a plain object or an array (own prototype only). */
export function is_plain(v: unknown): v is Record<string, unknown> | unknown[] {
	if (v === null || typeof v !== 'object') return false;
	if (Array.isArray(v)) return true;
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
}

const is_thenable = (v: unknown): boolean =>
	typeof (v as { then?: unknown } | null)?.then === 'function';
/** What one walk learns about a subtree. */
export interface Measure {
	/** Byte estimate of the subtree's serialized form (a threshold input, not an exact count). */
	readonly bytes: number;
	/** Referenceable: plain objects / arrays / plain leaves only, no cycle — a seed ref may point
	 *  at it and the client reads it back as the same plain data. */
	readonly ref: boolean;
	/** JSON-exact: `JSON.stringify` + `JSON.parse` reproduce it — no undefined, Date, bigint,
	 *  non-finite number, -0, class instance, Map/Set, cycle. What picks the JSON lane. */
	readonly json: boolean;
	/** A thenable somewhere inside (a streamed load promise the handle must stage or settle). */
	readonly thenable: boolean;
}

// THE PACKED MEASURE: one number per node — `bytes * 8 + flags`. A CMS tree is thousands of
// nodes; a measure object per node was a third of the walk's allocation and a GC line of its own.
// The number is exact up to 2^50 bytes, which no seed reaches.
export const F_REF = 1;
const F_JSON = 2;
const F_THENABLE = 4;
const P_OPAQUE = 0; // function, symbol, class instance, Map/Set, a cycle: 0 bytes, no lane
const P_THENABLE = F_THENABLE;
const P_NULLISH_JSON = 4 * 8 + F_REF + F_JSON; // null, boolean
const P_UNDEFINED = 4 * 8 + F_REF;
const P_NUMBER = 8 * 8 + F_REF + F_JSON;
const P_NUMBER_NOJSON = 8 * 8 + F_REF; // NaN, ±Infinity, -0
const P_BIGINT = 8 * 8 + F_REF;
const P_DATE = 24 * 8 + F_REF;
/** The memo mark of a node whose walk has not finished: meeting it again is a cycle. */
const IN_PROGRESS = -1;

export const bytes_of = (p: number): number => (p - (p & 7)) / 8;

function unpack(p: number): Measure {
	return {
		bytes: bytes_of(p),
		ref: (p & F_REF) !== 0,
		json: (p & F_JSON) !== 0,
		thenable: (p & F_THENABLE) !== 0
	};
}

/** Per-node measures: plain object / array → packed measure. Shared across every root measured in
 *  one request (the handle installs a reader); a fresh one per root outside a request. */
export type MeasureMemo = Map<object, number>;

/**
 * The one walk: measure a value (post-order, memoised per plain node in `memo`). Every child is
 * measured even after one disqualifies the parent: a clean sibling deeper in the tree must still
 * get its own entry (the index walk reads the memo). Strings never enter the memo. A node already
 * in the memo — from this root or from any other root measured with the same memo — is a lookup.
 */
export function measure(v: unknown, memo: MeasureMemo): number {
	switch (typeof v) {
		case 'string':
			return (v.length + 2) * 8 + F_REF + F_JSON;
		case 'number':
			return Number.isFinite(v) && !Object.is(v, -0) ? P_NUMBER : P_NUMBER_NOJSON;
		case 'boolean':
			return P_NULLISH_JSON;
		case 'undefined':
			return P_UNDEFINED;
		case 'bigint':
			return P_BIGINT;
		case 'object':
			break;
		default:
			return P_OPAQUE; // function, symbol
	}
	if (v === null) return P_NULLISH_JSON;
	if (v instanceof Date) return P_DATE;
	if (!is_plain(v)) return is_thenable(v) ? P_THENABLE : P_OPAQUE;
	const cached = memo.get(v);
	// An ancestor still being walked: a cycle — opaque to the parent (never a lane, never a ref).
	if (cached !== undefined) return cached === IN_PROGRESS ? P_OPAQUE : cached;
	// A plain-looking object carrying a SYMBOL key is a branded value (a held region, an og.$ fn
	// descriptor, a hub brand) that a devalue reducer claims: JSON would drop the brand and a seed
	// reference would copy it without one. Opaque, like a class instance.
	if (!Array.isArray(v) && Object.getOwnPropertySymbols(v).length > 0) {
		memo.set(v, P_OPAQUE);
		return P_OPAQUE;
	}
	let bytes = 0;
	let lanes = F_REF | F_JSON; // and-accumulated: one disqualified child clears the lane
	let thenable = 0; // or-accumulated
	// The in-progress mark (the cycle detector) is written only when a child is an object that could
	// lead back here — a leaf-only node (most of a CMS tree: a row, a link, a tag list) writes the
	// memo once, not twice.
	let marked = false;
	if (Array.isArray(v)) {
		for (let i = 0; i < v.length; i++) {
			const c = v[i];
			if (typeof c === 'string') {
				bytes += c.length + 3;
				continue;
			}
			if (!marked && typeof c === 'object' && c !== null) {
				memo.set(v, IN_PROGRESS);
				marked = true;
			}
			const p = measure(c, memo);
			bytes += bytes_of(p) + 1;
			lanes &= p;
			thenable |= p & F_THENABLE;
		}
	} else {
		for (const key in v) {
			const c = (v as Record<string, unknown>)[key];
			if (typeof c === 'string') {
				bytes += c.length + key.length + 5;
				continue;
			}
			// An `undefined` PROPERTY keeps the JSON lane: `JSON.stringify` drops the key, and reading
			// it back gives `undefined` either way (only `key in obj` would tell — nothing on the wire
			// relies on that). One such leaf in a 690 KB CMS tree was pushing the whole seed onto the
			// devalue lane. An `undefined` ARRAY ELEMENT stays devalue: JSON would turn it into null.
			if (c === undefined) {
				bytes += key.length + 4;
				continue;
			}
			if (!marked && typeof c === 'object' && c !== null) {
				memo.set(v, IN_PROGRESS);
				marked = true;
			}
			const p = measure(c, memo);
			bytes += bytes_of(p) + key.length + 3;
			lanes &= p;
			thenable |= p & F_THENABLE;
		}
	}
	const result = bytes * 8 + (lanes & (F_REF | F_JSON)) + thenable;
	memo.set(v, result);
	return result;
}

export interface Analysis {
	root: Measure;
	memo: MeasureMemo;
}

type MemoReader = () => MeasureMemo | null;
let memo_reader: MemoReader | null = null;

/** Server (`hooks.ts`) installs a request-scoped reader: every root measured during one request
 *  shares one memo, so a subtree reached from two roots (the seed and an island's props) is walked
 *  once. `null` uninstalls; off-request (a hole endpoint, a test) each root gets its own memo. */
export function set_measure_memo_reader(fn: MemoReader | null): void {
	memo_reader = fn;
}

const analysis_cache = new WeakMap<object, Analysis>();

/** The walk, cached per plain root object: the seed's `page.data` is measured once per request
 *  however many islands, lanes and decisions ask; a props object once per island — and against
 *  the request's shared memo, so a props object that is a seed node costs a lookup. */
export function analysis(value: unknown): Analysis {
	if (!is_plain(value)) {
		const memo: MeasureMemo = new Map();
		return { root: unpack(measure(value, memo)), memo };
	}
	const hit = analysis_cache.get(value);
	if (hit) return hit;
	const memo = memo_reader?.() ?? new Map<object, number>();
	const a: Analysis = { root: unpack(measure(value, memo)), memo };
	analysis_cache.set(value, a);
	return a;
}

/** What one walk says about a value (see {@link Measure}). */
export function analyze(value: unknown): Measure {
	return analysis(value).root;
}

/**
 * WHY a tree is not JSON-exact: the path of the first leaf that disqualifies it, with what it
 * is — `config.updated (Date)`, `rows[3].price (NaN)`, `facets (Map)`, `meta (class Foo)`. A
 * separate walk on purpose (the measuring walk carries no paths); the handle runs it only for a
 * tree that left the JSON lane and only while the profiler records. `null` for a JSON tree.
 */
export function json_culprit(value: unknown, max_depth = 64): string | null {
	const seen = new Set<object>();
	const why = (v: unknown): string | null => {
		switch (typeof v) {
			case 'string':
			case 'boolean':
				return null;
			case 'number':
				if (Number.isFinite(v)) return Object.is(v, -0) ? '-0' : null;
				return Number.isNaN(v) ? 'NaN' : 'Infinity';
			case 'undefined':
				return 'undefined';
			case 'bigint':
				return 'bigint';
			case 'function':
				return 'function';
			case 'symbol':
				return 'symbol';
			default:
				return null; // object: decided by the walk
		}
	};
	const walk = (v: unknown, path: string, depth: number): string | null => {
		const leaf = why(v);
		if (leaf) return `${path || '(root)'} (${leaf})`;
		if (v === null || typeof v !== 'object') return null;
		if (v instanceof Date) return `${path || '(root)'} (Date)`;
		if (v instanceof Map) return `${path || '(root)'} (Map)`;
		if (v instanceof Set) return `${path || '(root)'} (Set)`;
		if (typeof (v as { then?: unknown }).then === 'function')
			return `${path || '(root)'} (Promise)`;
		if (!is_plain(v)) {
			const name = (Object.getPrototypeOf(v) as { constructor?: { name?: string } } | null)
				?.constructor?.name;
			return `${path || '(root)'} (class ${name || 'instance'})`;
		}
		if (seen.has(v)) return `${path || '(root)'} (cycle)`;
		if (depth > max_depth) return null;
		seen.add(v);
		if (Array.isArray(v)) {
			for (let i = 0; i < v.length; i++) {
				if (v[i] === undefined) return `${path}[${i}] (undefined in array)`;
				const r = walk(v[i], `${path}[${i}]`, depth + 1);
				if (r) return r;
			}
		} else {
			if (Object.getOwnPropertySymbols(v).length > 0) return `${path || '(root)'} (symbol-branded)`;
			for (const key in v) {
				const c = (v as Record<string, unknown>)[key];
				if (c === undefined) continue; // an undefined PROPERTY keeps the JSON lane
				const r = walk(c, path ? `${path}.${key}` : key, depth + 1);
				if (r) return r;
			}
		}
		seen.delete(v);
		return null;
	};
	return walk(value, '', 0);
}
