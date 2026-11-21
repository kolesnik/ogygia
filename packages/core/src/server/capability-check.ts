/**
 * THE ISLANDS ENDPOINT'S CHECKS of an asked region capability: its numbers' one spelling, and its
 * MAC. Minting lives in server/hmac.ts and server/endpoint.ts; only the endpoint checks, so a
 * server without holes holds none of this (apps/palaestra/e2e/server-size.ts SERVER_PROGRAMS).
 *
 * @packageDocumentation
 */
import { REGION_CAPABILITY_VERSION } from './endpoint.ts';
import { claim_fields, region_capability, type RegionClaim } from './hmac.ts';

/** server/endpoint.ts `REGION_TTL_RE`: empty, or 1–7 ASCII digits, spelled as
 *  {@link is_signed_number}. */
export function is_region_ttl(s: string): boolean {
	return s === '' || is_signed_number(s, 7);
}

/**
 * A number in a signed region URL (`exp`, `ttl`) in its one spelling: 1 to `max` ASCII digits, no
 * leading zero ("0" itself aside), as ogygia mints it (`String(n)`). Any other spelling of the same
 * number (`+n`, `0n`, `n.0`, `1e3`, `0x…`) is another URL for one capability, refused as shape
 * before the MAC (test/capability-canonical-numbers.test.ts).
 */
export function is_signed_number(s: string, max: number): boolean {
	if (s.length === 0 || s.length > max || (s.length > 1 && s.charCodeAt(0) === 48)) return false;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		if (c < 48 || c > 57) return false;
	}
	return true;
}

/**
 * Does `sig` sign this region capability? `version` is the URL's `v`: `'3'` checks it through
 * capability() for `audience`; anything else is refused, a capability minted before v3 (no `v`)
 * among them: its page is an earlier build's, whose runtime cannot read this build's answer
 * (#1769). `late_sec`: a renewal's window past expiry.
 */
export function region_verify(
	secret: string,
	audience: string,
	version: string,
	exp: string,
	claim: RegionClaim,
	sig: string,
	late_sec = 0
): boolean {
	const at = Number(exp);
	if (version !== REGION_CAPABILITY_VERSION || !Number.isSafeInteger(at) || at < 0) return false;
	const token = `v${version}.${at * 1000}..${sig}`;
	return region_capability(secret, late_sec).check(token, audience, claim_fields(claim)).ok;
}
