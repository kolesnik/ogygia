/**
 * DEVALUE'S TEXT, WRITTEN FASTER: `stringify(value, reducers)` from devalue, byte for byte, for
 * what island props carry (plain objects, dense arrays, primitives, Date, Map, Set, and what a
 * reducer claims). A string with nothing to escape, nearly every one, is quoted after one native
 * scan; devalue's own quoting walks every string a character at a time, which was most of a
 * devalue-lane island's serialize. Any other value hands the whole value to
 * devalue, whose reducers answer what this pass already asked them (each reducer runs once per
 * value), so the text and the reducers' effects are devalue's.
 */
import { stringify } from 'devalue';

type Reducers = Record<string, (value: unknown) => unknown>;

const UNDEFINED = -1;
const NAN = -3;
const POSITIVE_INFINITY = -4;
const NEGATIVE_INFINITY = -5;
const NEGATIVE_ZERO = -6;

/** A character devalue writes as an escape (a surrogate, paired or not, it writes raw). */
// oxlint-disable-next-line no-control-regex -- devalue escapes every control character
const ESCAPED_RE = /[\u0000-\u001f"\\<\u2028\u2029]/;
const OBJECT_PROTO_NAMES = Object.getOwnPropertyNames(Object.prototype).sort().join('\0');

/** A value this pass leaves to devalue. */
class Unwritten {}
const UNWRITTEN = new Unwritten();

/** A string as devalue quotes it (utils.js `stringify_string`): as it is when nothing in it is
 *  escaped, the common case, found by one native scan. */
function quote(s: string): string {
	return ESCAPED_RE.test(s) ? quote_escaped(s) : `"${s}"`;
}

/** The escape devalue writes for a character code, or null when it writes the character itself. */
function escape_of(c: number): string | null {
	if (c === 34) return '\\"';
	if (c === 60) return '\\u003C';
	if (c === 92) return '\\\\';
	if (c === 0x2028) return '\\u2028';
	if (c === 0x2029) return '\\u2029';
	if (c >= 32) return null;
	if (c === 10) return '\\n';
	if (c === 13) return '\\r';
	if (c === 9) return '\\t';
	if (c === 8) return '\\b';
	if (c === 12) return '\\f';
	return `\\u${c.toString(16).padStart(4, '0')}`;
}

/** devalue's quoting of a string that holds an escape: the runs between escapes copied whole. */
function quote_escaped(s: string): string {
	let out = '';
	let last = 0;
	for (let i = 0; i < s.length; i++) {
		const escape = escape_of(s.charCodeAt(i));
		if (escape !== null) {
			// oxlint-disable-next-line ogygia/no-string-concat -- devalue's own walk; a join per string costs more than the appends (props wire, devalue lane: +11.5% steps, serialize.bench)
			out += `${s.slice(last, i)}${escape}`;
			last = i + 1;
		}
	}
	return `"${last === 0 ? s : `${out}${s.slice(last)}`}"`;
}

/** devalue's plain object (utils.js `is_plain_object`), without symbol keys. */
function is_plain(o: object): boolean {
	const proto = Object.getPrototypeOf(o) as object | null;
	if (
		!(
			proto === Object.prototype ||
			proto === null ||
			Object.getPrototypeOf(proto) === null ||
			Object.getOwnPropertyNames(proto).sort().join('\0') === OBJECT_PROTO_NAMES
		)
	)
		return false;
	for (const s of Object.getOwnPropertySymbols(o))
		if (Object.getOwnPropertyDescriptor(o, s)!.enumerable) return false;
	return true;
}

/** devalue's text of `value` with `reducers`, as `stringify(value, reducers)` writes it. */
export function devalue_text(value: unknown, reducers: Reducers): string {
	const custom = Object.getOwnPropertyNames(reducers).map((key) => ({ key, fn: reducers[key]! }));
	/** what the reducers said of each value this pass offered them, by its index */
	const claims: ({ key: string; value: unknown } | null)[] = [];
	const indexes = new Map<unknown, number>();
	const out: string[] = [];
	let p = 0;

	const flatten = (thing: unknown): number => {
		if (thing === undefined) return UNDEFINED;
		const type = typeof thing;
		if (type === 'number') {
			const n = thing as number;
			if (Number.isNaN(n)) return NAN;
			if (n === Infinity) return POSITIVE_INFINITY;
			if (n === -Infinity) return NEGATIVE_INFINITY;
			if (n === 0 && 1 / n < 0) return NEGATIVE_ZERO;
		}
		const seen = indexes.get(thing);
		if (seen !== undefined) return seen;
		const index = p++;
		indexes.set(thing, index);
		for (const { key, fn } of custom) {
			const reduced = fn(thing);
			if (reduced) {
				claims[index] = { key, value: reduced };
				out[index] = `["${key}",${flatten(reduced)}]`;
				return index;
			}
		}
		claims[index] = null;
		if (thing === null) out[index] = 'null';
		else if (type === 'string') out[index] = quote(thing as string);
		else if (type === 'number' || type === 'boolean') out[index] = String(thing);
		else if (type === 'bigint') out[index] = `["BigInt","${thing as bigint}"]`;
		else if (type !== 'object') throw UNWRITTEN;
		else return write_object(thing as Record<string, unknown>, index);
		return index;
	};

	const write_object = (o: Record<string, unknown>, index: number): number => {
		if (typeof o.then === 'function') throw UNWRITTEN;
		const tag = Object.prototype.toString.call(o).slice(8, -1);
		if (tag === 'Array') {
			const a = o as unknown as unknown[];
			let text = '[';
			for (let i = 0; i < a.length; i++) {
				if (!Object.hasOwn(a, i)) throw UNWRITTEN;
				// oxlint-disable-next-line ogygia/no-string-concat -- devalue's text, built as it builds it: a join per value costs more than the appends (props wire, devalue lane: +11.5% steps, serialize.bench)
				text += i > 0 ? `,${flatten(a[i])}` : flatten(a[i]);
			}
			out[index] = `${text}]`;
		} else if (tag === 'Date') {
			const d = o as unknown as Date;
			out[index] = `["Date","${Number.isNaN(d.getDate()) ? '' : d.toISOString()}"]`;
		} else if (tag === 'Map') {
			let text = '["Map"';
			for (const [k, v] of o as unknown as Map<unknown, unknown>)
				// oxlint-disable-next-line ogygia/no-string-concat -- devalue's text, built as it builds it: a join per value costs more than the appends (props wire, devalue lane: +11.5% steps, serialize.bench)
				text += `,${flatten(k)},${flatten(v)}`;
			out[index] = `${text}]`;
		} else if (tag === 'Set') {
			let text = '["Set"';
			for (const v of o as unknown as Set<unknown>)
				// oxlint-disable-next-line ogygia/no-string-concat -- devalue's text, built as it builds it: a join per value costs more than the appends (props wire, devalue lane: +11.5% steps, serialize.bench)
				text += `,${flatten(v)}`;
			out[index] = `${text}]`;
		} else if (tag === 'Object' && is_plain(o) && Object.getPrototypeOf(o) !== null) {
			let text = '{';
			let started = false;
			for (const key of Object.keys(o)) {
				if (key === '__proto__') throw UNWRITTEN;
				// oxlint-disable-next-line ogygia/no-string-concat -- devalue's text, built as it builds it: a join per value costs more than the appends (props wire, devalue lane: +11.5% steps, serialize.bench)
				text += `${started ? ',' : ''}${quote(key)}:${flatten(o[key])}`;
				started = true;
			}
			out[index] = `${text}}`;
		} else throw UNWRITTEN;
		return index;
	};

	try {
		const root = flatten(value);
		return root < 0 ? `${root}` : `[${out.join(',')}]`;
	} catch (e) {
		if (e !== UNWRITTEN) throw e;
	}
	// (devalue writes it whole; a value this pass offered the reducers gets their first answer)
	const answered: Reducers = {};
	for (const { key, fn } of custom)
		answered[key] = (v) => {
			const at = indexes.get(v);
			const claim = at === undefined ? undefined : claims[at];
			if (claim === undefined) return fn(v);
			return claim !== null && claim.key === key ? claim.value : undefined;
		};
	return stringify(value, answered);
}
