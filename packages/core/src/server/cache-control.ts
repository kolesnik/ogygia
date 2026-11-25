/**
 * THE HANDLE'S HALF of server/shared-cache.ts: the `cache-control` a page's load sets, read into how
 * long shared caches keep the document. Only the handle's frames path imports it, so a server
 * without holes holds none of it (apps/palaestra/e2e/server-size.ts SERVER_PROGRAMS).
 *
 * @packageDocumentation
 */
import { note_shared_lifetime } from './shared-cache.ts';

/**
 * How long shared caches may serve a document with this `cache-control`, in seconds: its freshness
 * (`s-maxage`, else `max-age`) plus `stale-while-revalidate`. 0 when shared caches may not keep it
 * (`private`, `no-store`) or must revalidate every use (`no-cache`). `max-age` counts without
 * `public`: a shared cache may store any response not marked `private` (RFC 9111 §3).
 * `stale-if-error` does not count: it serves a stale copy only while the origin is failing, when a
 * hole could not render anyway.
 */
export function shared_cache_lifetime(cache_control: string): number {
	let s_maxage = -1;
	let max_age = -1;
	let swr = 0;
	for (const part of cache_control.toLowerCase().split(',')) {
		const eq = part.indexOf('=');
		const name = (eq === -1 ? part : part.slice(0, eq)).trim();
		if (name === 'private' || name === 'no-store' || name === 'no-cache') return 0;
		if (eq === -1) continue;
		const n = seconds(part.slice(eq + 1));
		if (n === null) continue;
		if (name === 's-maxage') s_maxage = n;
		else if (name === 'max-age') max_age = n;
		else if (name === 'stale-while-revalidate') swr = n;
	}
	if (s_maxage >= 0) return s_maxage + swr;
	return (max_age >= 0 ? max_age : 0) + swr;
}

/** A delta-seconds value (optionally quoted), or null. */
function seconds(raw: string): number | null {
	let v = raw.trim();
	if (v.length >= 2 && v[0] === '"' && v[v.length - 1] === '"') v = v.slice(1, -1);
	if (v === '' || v.length > 10) return null;
	for (let i = 0; i < v.length; i++) {
		const c = v.charCodeAt(i);
		if (c < 48 || c > 57) return null;
	}
	return Number(v);
}

/** The handle: a load set `cache-control` on this page request. */
export function note_cache_control(request: Request, cache_control: string): void {
	note_shared_lifetime(request, shared_cache_lifetime(cache_control));
}
