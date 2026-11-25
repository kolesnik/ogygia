/**
 * HOLES ON A CACHED DOCUMENT — a deferred hole's capability must outlive the document it sits in.
 *
 * A page whose load says `cache-control: public, s-maxage=604800` is served from a CDN for a week,
 * but its holes were minted for `ttl` (an hour by default, capped at a day): once that passed,
 * every visitor served the cached copy got a 403 for every hole, and nothing logged it. Prerender
 * already solves the same problem by signing for the life of the deploy; this is the request-time
 * equivalent, bounded by what the app itself declared.
 *
 * 1. The handle notes the `cache-control` a load sets (`setHeaders`) on the page request; the mint
 *    reads it and signs an ANONYMOUS hole for twice that lifetime (`capability_expiry` guarantees
 *    only half of a ttl). Same safety argument as prerender: the props are already in the public
 *    HTML, and nothing session-bound is extended.
 * 2. A document already cached with short-lived holes (or one whose cache header a handle set after
 *    the render, where the mint cannot see it) is rescued by RENEWAL: the runtime retries an expired
 *    hole once with `&renew=1`, and the handle re-signs a capability it minted itself, anonymous,
 *    expired by at most {@link RENEW_WINDOW_SEC}.
 *
 * State rides ONE `globalThis` + `Symbol.for` slot (the PAGE-STATE-SINGLETON law): the handle
 * (hooks.js) records and the mint (server/region-endpoint.js) reads, and dist entries can each carry
 * their own evaluation of this module — a module-local map would split the seam.
 */
import { PRERENDER_REGION_TTL_SEC } from './endpoint.ts';
import { slot as shared } from '@ogygia/machine';
import { RENEW_WINDOW_SEC } from '../contract/capability.ts';

export { RENEW_WINDOW_SEC };

/**
 * The capability lifetime to mint with: prerender-grade for a stored page (prerender / postrender);
 * for an anonymous hole on a document shared caches keep for `shared` seconds, twice that (so the
 * window-aligned expiry still covers the whole cache life), capped at prerender-grade; else
 * `ttl`. A session-bound hole is never extended — its document is the visitor's own.
 */
export function mint_ttl_sec(o: {
	stored: boolean;
	session: string;
	shared: number;
	region_ttl: number;
}): number {
	if (o.stored) return PRERENDER_REGION_TTL_SEC;
	if (o.session !== '' || o.shared <= 0) return o.region_ttl;
	return Math.min(PRERENDER_REGION_TTL_SEC, Math.max(o.region_ttl, 2 * o.shared));
}

/** A renewable expiry: an integer that HAS passed, by at most `window` seconds (the app's
 *  `maxPageAge`; `0` renews nothing). */
export function renewable_expiry(
	exp_raw: string,
	now_sec: number,
	window: number = RENEW_WINDOW_SEC
): boolean {
	if (window <= 0 || exp_raw === '' || exp_raw.length > 12) return false;
	for (let i = 0; i < exp_raw.length; i++) {
		const c = exp_raw.charCodeAt(i);
		if (c < 48 || c > 57) return false;
	}
	const exp = Number(exp_raw);
	return exp < now_sec && now_sec - exp <= window;
}

/** Why a capability's `exp` refuses it, or null: past it (`expired`); for a renewal, not inside
 *  the renew window (`renew-window`), so a URL that has not expired never renews. */
export function expiry_refusal(
	exp_raw: string,
	now_sec: number,
	renewal: boolean,
	window: number
): 'expired' | 'renew-window' | null {
	if (renewal) return renewable_expiry(exp_raw, now_sec, window) ? null : 'renew-window';
	const exp = Number(exp_raw);
	return !Number.isFinite(exp) || exp < now_sec ? 'expired' : null;
}

// ── the per-request seam ─────────────────────────────────────────────────────────────────────────
interface Slot {
	by_request: WeakMap<Request, number>;
}
const slot = shared<Slot>({
	name: 'ogygia.shared-cache',
	version: 1,
	make: () => ({ by_request: new WeakMap() })
});

/** The handle: shared caches keep this page request's document for `seconds` (server/cache-control.ts
 *  reads them from the `cache-control` a load set). */
export function note_shared_lifetime(request: Request, seconds: number): void {
	slot.by_request.set(request, seconds);
}

/** The mint: how long shared caches keep the document this request renders (0 = unknown / none). */
export function document_shared_lifetime(request: Request | null | undefined): number {
	return request ? (slot.by_request.get(request) ?? 0) : 0;
}
