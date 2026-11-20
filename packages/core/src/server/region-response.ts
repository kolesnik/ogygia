/**
 * THE REGION ANSWERS' SHAPE: the headers every answer of the islands endpoint carries, and the
 * refusals the handle, the endpoint and the plugins' signed holes answer with.
 */
import type { RequestEvent } from '@sveltejs/kit';
import { signing_key } from './signing-key.ts';
import type { RateLimiter } from './rate-limit.ts';

const REGION_FRAME_HEADERS = {
	'X-Frame-Options': 'DENY',
	'Content-Security-Policy': "frame-ancestors 'none'",
	'X-Content-Type-Options': 'nosniff',
	'Referrer-Policy': 'no-referrer'
} as const;

/** A region answer: never framed, never sniffed, never stored unless `init` says so. */
export function region_response(
	body: BodyInit | null,
	init: { status: number; headers?: Record<string, string> }
): Response {
	return new Response(body, {
		status: init.status,
		headers: { ...REGION_FRAME_HEADERS, 'cache-control': 'no-store', ...init.headers }
	});
}

/** A 429 for `ip`, with the time its budget has left. */
export function over_budget(limiter: RateLimiter, ip: string): Response {
	return region_response('Too Many Requests', {
		status: 429,
		headers: { 'retry-after': String(limiter.retry_after_s(ip)) }
	});
}

/** Why a region capability is refused. */
export type RegionDeny =
	| 'cross-site'
	| 'shape'
	| 'expired'
	| 'renew-window'
	| 'renew-session'
	| 'foreign-key'
	| 'sig'
	| 'unknown-id'
	| 'props'
	| 'oversize';

/** A 403 that says why, with the fingerprint of the key this server signs with. */
export function region_denied(why: RegionDeny): Response {
	return region_response('Forbidden', {
		status: 403,
		headers: { 'x-ogygia-deny': why, 'x-ogygia-key': signing_key().fp }
	});
}

/** The visitor's address, or null when the platform gives none (the callers answer 429). */
export function client_ip(event: RequestEvent): string | null {
	try {
		return event.getClientAddress();
		// oxlint-disable-next-line ogygia/no-silent-failures -- fail closed: the callers answer 429
	} catch {
		return null;
	}
}
