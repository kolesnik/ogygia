/**
 * Absolute URLs inside a hole's HTML.
 *
 * A server island renders in its OWN request — `/__ogygia__?…` — and Kit's `asset()` (with the
 * default `paths.relative`) emits every URL relative to THAT request: `./_app/immutable/x.js`,
 * `./__ogygia__?…`. The HTML then lands in a page at any depth (`/docs/guides/`), and a
 * region entry / nested-hole endpoint / region-css link inside it would resolve against the page:
 * `/docs/guides/_app/…` → 404, a dead island in a live hole. The batch parcel and an
 * ESI-stitched hole (the CDN splices the bytes straight into the page) have the same problem, so
 * the fix is on the server, once, at the point the response is assembled: resolve every relative
 * ogygia URL against the endpoint request URL and emit it root-absolute (Kit `base` included).
 * Absolute (`/…`) and scheme'd (foreign federation entries) values are left alone.
 */
import { escape_amp } from '../escape.ts';
import { Needle, next_tag, OGYGIA_REGION_CSS, value_at, type FoundTag } from '../wire-markup.ts';
import { REGION_CSS_ANY_CASE } from './html-scan.ts';

// The attribute sites ogygia writes URLs into hole HTML: an `<ogygia-region>`'s `entry` / `src` /
// `endpoint`, a region-css `<link>`'s `href`, an inlined region sheet's `data-ogygia-region-css`
// identity. Values are attribute-escaped (`&` → `&amp;`), so the resolver un-escapes, resolves, and
// re-escapes. Tags are read through the browser-faithful reader (wire-markup.ts), each value
// rewritten only when it is relative.
// (`src` too: an island's location, written beside its identity since locations — left relative,
// an island inside a hole imported `/<page>/_app/…` and woke on a redirect to an HTML page)
const REGION_URL_ATTRS = ['entry', 'src', 'endpoint'] as const;

const PLAIN_RELATIVE_RE = /^\.\/([\w\-.~!$&()*+,;=:@/]*)(\?[\w\-.~!$&()*+,;=:@/?%]*)?$/;

/** The root path each `./` or `../` URL of a hole's answer resolves to against the endpoint request URL
 *  (its base). A plain `./` URL (the ones ogygia writes) is the base's directory, the path and the
 *  query, as the URL parser resolves it (test/property-root-paths.test.ts); any other goes through it. */
export class RootPaths {
	readonly #base: URL;
	#dir: string | null = null;

	constructor(base: URL) {
		this.#base = base;
	}

	/** `value` as a root path (`/…`, its query and hash), or null when it resolves to another origin. */
	resolve(value: string): string | null {
		const plain = PLAIN_RELATIVE_RE.exec(value);
		if (plain !== null && !`/${plain[1]}`.includes('/.')) {
			if (this.#dir === null) {
				const path = this.#base.pathname;
				this.#dir = path.slice(0, path.lastIndexOf('/') + 1);
			}
			const query = plain[2];
			return this.#dir + plain[1] + (query === undefined || query.length === 1 ? '' : query);
		}
		const resolved = new URL(value, this.#base);
		if (resolved.origin !== this.#base.origin) return null;
		return resolved.pathname + resolved.search + resolved.hash;
	}
}

function resolve_attr(value: string, roots: RootPaths): string {
	if (!value || !(value.startsWith('./') || value.startsWith('../'))) return value;
	const resolved = roots.resolve(
		value.indexOf('&amp;') === -1 ? value : value.replaceAll('&amp;', '&')
	);
	return resolved === null ? value : escape_amp(resolved);
}

/** One value rewrite: `html[at, end)` becomes `text`. */
interface Splice {
	at: number;
	end: number;
	text: string;
}

/** Queue the rewrite of `tag`'s `attr` value when it is relative. */
function splice_value(
	html: string,
	tag: FoundTag,
	name: string,
	attr: string,
	roots: RootPaths,
	out: Splice[]
): void {
	const value = tag.attr(attr);
	if (value === undefined) return;
	const next = resolve_attr(value, roots);
	if (next === value) return;
	const at = value_at(html, tag, name, attr);
	if (at !== -1) out.push({ at, end: at + value.length, text: next });
}

/** Rewrite the relative `entry` / `src` / `endpoint` / region-css `href` values in `html` to root-absolute
 *  paths resolved against `base` (the endpoint request URL). */
export function absolutize_hole_html(html: string, base: URL): string {
	const splices: Splice[] = [];
	const roots = new RootPaths(base);
	// (a relative value holds `./`: a region tag whose span has none is passed without a read)
	const dot = new Needle(html, './');
	if (dot.gone) return html;
	for (
		let t = next_tag(html, 'ogygia-region', 0);
		t !== null;
		t = next_tag(html, 'ogygia-region', t.next)
	) {
		const held = dot.holds(t);
		if (dot.gone) break;
		if (!held) continue;
		for (const attr of REGION_URL_ATTRS)
			splice_value(html, t, 'ogygia-region', attr, roots, splices);
	}
	// region CSS: only a tag whose span holds the attribute's name gets an attribute read
	for (const name of ['link', 'style'] as const) {
		const mark = new Needle(html, REGION_CSS_ANY_CASE);
		if (mark.gone) break;
		for (let t = next_tag(html, name, 0); t !== null; t = next_tag(html, name, t.next)) {
			const held = mark.holds(t);
			if (mark.gone) break;
			if (!held || t.attr(OGYGIA_REGION_CSS) === undefined) continue;
			splice_value(html, t, name, name === 'link' ? 'href' : OGYGIA_REGION_CSS, roots, splices);
		}
	}
	if (splices.length === 0) return html;
	splices.sort((a, b) => a.at - b.at);
	let out = '';
	let pos = 0;
	for (const s of splices) {
		out += html.slice(pos, s.at) + s.text;
		pos = s.end;
	}
	return out + html.slice(pos);
}
