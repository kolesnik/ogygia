/**
 * KIT'S `asset()` FOR OGYGIA'S URLS. ogygia bakes every URL base-less with a leading slash
 * (`/_app/immutable/…`, `/@id/…`) and runs it through Kit's `asset()` at render — the one authority on
 * the base, the assets CDN and page-relative paths. Kit 2 takes the path with its leading slash; Kit 3
 * takes it without (and warns on every call with it, in dev — one warning per island render).
 *
 * WHICH KIT is a build-time fact: the plugin reads the app's Kit and defines `__OGYGIA_KIT_MAJOR__`. It
 * used to be probed (try the path without its slash; a refusal means Kit 2) — but Kit 2 refuses only in
 * DEV: in a build it accepted the slash-less path and returned it page-relative (`_app/immutable/x.js`),
 * so on a page below the root every island entry resolved against the page (`/account/_app/…`) and 404'd.
 * Without the define (a plain node import of dist/), the probe stands in, its answer checked: a result
 * that is neither root-absolute, page-relative with a dot, nor a full URL is Kit 2's slash-less mistake.
 */
import { asset } from '$app/paths';

const KIT_MAJOR = typeof __OGYGIA_KIT_MAJOR__ !== 'undefined' ? __OGYGIA_KIT_MAJOR__ : null;

/** this Kit wants the leading slash (it refused the path without one); null until the first call */
let wants_slash: boolean | null = KIT_MAJOR === null ? null : KIT_MAJOR < 3;

/** A URL `asset()` may legitimately return: root-absolute, `./` / `../` relative, or a full URL. */
function well_formed(url: string): boolean {
	return url.startsWith('/') || url.startsWith('.') || url.includes('://');
}

export { app_path } from './app-base.ts';

/** The request an `asset()` answer is for: the prefix Kit puts before a path depends on it alone (its
 *  page's depth, a data request, a prerender). Null outside one, and on the client. */
let asset_request: (() => object | null) | null = null;
/** Rules on: each answer the prefix made, with Kit's own for the same path. */
let asset_check: ((path: string, ours: string, kits: string) => void) | null = null;
/** Each request's prefix (null: Kit's answer for the probe is not prefix + path, so Kit answers each). */
const prefixes = new WeakMap<object, string | null>();
const PROBE = '/_app';

/** Installs the reader of the request `asset()` answers for (the server's handle), and with rules on
 *  the check of each answer against Kit's. */
export function set_asset_request_reader(
	read: (() => object | null) | null,
	check: ((path: string, ours: string, kits: string) => void) | null = null
): void {
	asset_request = read;
	asset_check = check;
}

/** A path Kit's `resolve` returns as it is: no `[param]`, no `(group)` segment, no empty segment. */
function plain_path(file: string): boolean {
	return !file.includes('[') && !file.includes('(') && !file.includes('//');
}

/** Kit's `asset()` for a base-less URL ogygia baked (`/_app/immutable/x.js`). Within one request Kit
 *  answers a plain path as one prefix and the path, so it is asked once per request (its answer for
 *  a probe) instead of once per URL: each ask resolves the path as a route. */
export function kit_asset(file: string): string {
	if (asset_request !== null && wants_slash !== null) {
		const request = asset_request();
		if (request !== null && file.startsWith('/') && plain_path(file)) {
			let prefix = prefixes.get(request);
			if (prefix === undefined) prefixes.set(request, (prefix = asset_prefix(wants_slash)));
			if (prefix !== null) {
				const out = prefix + (wants_slash ? file : file.slice(1));
				if (asset_check !== null) asset_check(file, out, kit_call(file));
				return out;
			}
		}
	}
	return kit_call(file);
}

/** What Kit puts before a path in this request, or null when its answer for the probe is not that. */
function asset_prefix(slash: boolean): string | null {
	const arg = slash ? PROBE : PROBE.slice(1);
	const out = (asset as (f: string) => string)(arg);
	return out.endsWith(arg) ? out.slice(0, out.length - arg.length) : null;
}

function kit_call(file: string): string {
	const call = asset as (f: string) => string;
	if (!file.startsWith('/')) return call(file);
	if (wants_slash === null) {
		try {
			const out = call(file.slice(1));
			if (well_formed(out)) {
				wants_slash = false;
				return out;
			}
			// oxlint-disable-next-line ogygia/no-silent-failures -- Kit 2 in dev refuses it; the fallback below answers
		} catch {}
		wants_slash = true;
	}
	return call(wants_slash ? file : file.slice(1));
}
