// @why The seed walks as they were before lane S4 folded them into one walk (macros b5d4bb93a), frozen as the oracle the new walk is compared to (test: seed-walk-oracle.test.ts › every island's plan and wire text match the old walks)
import { fnv1a } from '../../src/contract/hash.ts';

type SeedPath = (string | number)[];
type Memo = Map<object, number>;

const F_REF = 1;
const F_JSON = 2;
const F_THENABLE = 4;
const P_OPAQUE = 0;
const P_THENABLE = F_THENABLE;
const P_NULLISH_JSON = 4 * 8 + F_REF + F_JSON;
const P_UNDEFINED = 4 * 8 + F_REF;
const P_NUMBER = 8 * 8 + F_REF + F_JSON;
const P_NUMBER_NOJSON = 8 * 8 + F_REF;
const P_BIGINT = 8 * 8 + F_REF;
const P_DATE = 24 * 8 + F_REF;
const IN_PROGRESS = -1;

export const bytes_of = (p: number): number => (p - (p & 7)) / 8;

export function is_plain(v: unknown): v is Record<string, unknown> | unknown[] {
	if (v === null || typeof v !== 'object') return false;
	if (Array.isArray(v)) return true;
	const proto = Object.getPrototypeOf(v);
	return proto === Object.prototype || proto === null;
}

const is_thenable = (v: unknown): boolean =>
	typeof (v as { then?: unknown } | null)?.then === 'function';

export interface OldMeasure {
	bytes: number;
	ref: boolean;
	json: boolean;
	thenable: boolean;
}

export const unpack = (p: number): OldMeasure => ({
	bytes: bytes_of(p),
	ref: (p & F_REF) !== 0,
	json: (p & F_JSON) !== 0,
	thenable: (p & F_THENABLE) !== 0
});

export function measure(v: unknown, memo: Memo): number {
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
			return P_OPAQUE;
	}
	if (v === null) return P_NULLISH_JSON;
	if (v instanceof Date) return P_DATE;
	if (!is_plain(v)) return is_thenable(v) ? P_THENABLE : P_OPAQUE;
	const cached = memo.get(v);
	if (cached !== undefined) return cached === IN_PROGRESS ? P_OPAQUE : cached;
	if (!Array.isArray(v) && Object.getOwnPropertySymbols(v).length > 0) {
		memo.set(v, P_OPAQUE);
		return P_OPAQUE;
	}
	let bytes = 0;
	let lanes = F_REF | F_JSON;
	let thenable = 0;
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

export function hash_subtree(
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
	if (on_stack.has(v)) return null;
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
	const result = ok ? { hash: fnv1a(acc.join('|')), bytes } : null;
	memo.set(v, result);
	return result;
}

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

export interface OldPlan {
	matched: Map<object, SeedPath>;
	count: number;
	keys: Set<string>;
}

/** The old index of `data`, measured with `memo` (the request memo as the old handle shared it). */
export class OldSeedIndex {
	readonly size: number;
	readonly touched = new Set<string>();
	readonly nodes: object[] = [];
	readonly memo: Memo;
	#at = new WeakMap<object, PathNode>();
	#by_bytes: Map<number, object[]> | null = null;
	#hash_memo = new Map<object, { hash: string; bytes: number } | null>();
	#by_hash = new Map<number, { hashed: number; first: Map<string, object> }>();

	constructor(data: unknown, memo: Memo, min_bytes = 96) {
		this.memo = memo;
		if (is_plain(data)) {
			measure(data, memo);
			const seen = new Set<object>();
			const enter = (c: unknown): c is Record<string, unknown> | unknown[] => {
				if (!is_plain(c) || seen.has(c)) return false;
				const p = memo.get(c);
				return p !== undefined && bytes_of(p) >= min_bytes;
			};
			const visit = (v: Record<string, unknown> | unknown[], here: PathNode) => {
				seen.add(v);
				if (memo.get(v)! & F_REF) {
					this.#at.set(v, here);
					this.nodes.push(v);
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
		this.size = this.nodes.length;
	}

	path(node: object): SeedPath | undefined {
		const here = this.#at.get(node);
		return here === undefined ? undefined : path_of(here);
	}

	candidates(bytes: number): readonly object[] {
		if (this.#by_bytes === null) {
			const by_bytes = (this.#by_bytes = new Map());
			for (const n of this.nodes) {
				const b = bytes_of(this.memo.get(n)!);
				const bucket = by_bytes.get(b);
				if (bucket) bucket.push(n);
				else by_bytes.set(b, [n]);
			}
		}
		return this.#by_bytes.get(bytes) ?? [];
	}

	match(bytes: number, hash: string): object | undefined {
		const bucket = this.candidates(bytes);
		if (bucket.length === 0) return undefined;
		let at = this.#by_hash.get(bytes);
		if (at === undefined) this.#by_hash.set(bytes, (at = { hashed: 0, first: new Map() }));
		const hit = at.first.get(hash);
		if (hit !== undefined) return hit;
		while (at.hashed < bucket.length) {
			const node = bucket[at.hashed++];
			const h = hash_subtree(node, this.#hash_memo, new Set())?.hash ?? null;
			if (h === null || at.first.has(h)) continue;
			at.first.set(h, node);
			if (h === hash) return node;
		}
		return undefined;
	}

	/** `memo`: the memo the props were measured with (the request's, as the old props wire had it). */
	plan(props: unknown, memo: Memo, min_bytes = 96): OldPlan {
		const matched = new Map<object, SeedPath>();
		const keys = new Set<string>();
		let count = 0;
		if (this.size > 0) {
			measure(props, memo);
			const hashed = new Map<object, { hash: string; bytes: number } | null>();
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
				const p = memo.get(v) ?? measure(v, memo);
				const bytes = bytes_of(p);
				if (bytes < min_bytes) return;
				if (p & F_REF && this.candidates(bytes).length) {
					const h = hash_subtree(v, hashed, new Set())?.hash ?? null;
					const cand = h ? this.match(bytes, h) : undefined;
					if (cand && deep_equal_plain(cand, v)) return hit(v, this.path(cand)!);
				}
				if (Array.isArray(v)) for (const item of v) visit(item);
				else for (const key in v) visit((v as Record<string, unknown>)[key]);
			};
			visit(props);
		}
		return { matched, count, keys };
	}
}
