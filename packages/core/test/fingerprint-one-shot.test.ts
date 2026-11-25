// The island fingerprint (server/fingerprint.ts `region_fingerprint`) hashes a short props text in
// one native call and a long one through a streaming hash: over generated entries and props texts,
// on both sides of the length where it switches, it is byte for byte the streaming hash it replaced
// (the old function, below, the oracle): non-ASCII, lone surrogates at either edge, and the empty
// text included.
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { region_fingerprint, ONE_SHOT_MAX } from '../src/server/fingerprint.ts';

function old_fingerprint(entry: string, canonical: string): string {
	return createHash('sha1').update(entry).update(' ').update(canonical).digest('hex').slice(0, 16);
}

const ch = (...points: number[]) => String.fromCharCode(...points);
const HIGH = ch(0xd800);
const LOW = ch(0xdc00);
const PAIR = ch(0xd83d, 0xde00);
const E_ACUTE = ch(0xe9);
const EM_DASH = ch(0x2014);
const LINE_SEP = ch(0x2028);

const EDGE = fc.constantFrom('', HIGH, LOW, PAIR, E_ACUTE, EM_DASH, LINE_SEP, '"', ' ');
const TEXT = fc.oneof(
	fc.string({ unit: 'binary', maxLength: 40 }),
	fc.string({ unit: 'grapheme', maxLength: 40 }),
	fc.tuple(EDGE, fc.string({ maxLength: 20 }), EDGE).map(([a, b, c]) => a + b + c)
);
/** A text near the switch: from a generated unit, just under, at, or just over it. */
const NEAR_SWITCH = fc
	.tuple(fc.constantFrom(-2, -1, 0, 1, 2), fc.constantFrom('a', E_ACUTE, PAIR, HIGH), EDGE)
	.map(([d, unit, edge]) => {
		const body = unit.repeat(Math.ceil((ONE_SHOT_MAX + d) / unit.length));
		return body.slice(0, Math.max(0, ONE_SHOT_MAX + d - edge.length)) + edge;
	});

describe('region_fingerprint · one native call for a short props text', () => {
	it('is the streaming hash of the same entry and text, over generated short texts', () => {
		fc.assert(
			fc.property(TEXT, TEXT, (entry, canonical) => {
				expect(region_fingerprint(entry, canonical)).toBe(old_fingerprint(entry, canonical));
			}),
			{ numRuns: 20_000 }
		);
	});

	it('is the streaming hash on both sides of the length where it switches', () => {
		fc.assert(
			fc.property(TEXT, NEAR_SWITCH, (entry, canonical) => {
				expect(region_fingerprint(entry, canonical)).toBe(old_fingerprint(entry, canonical));
			}),
			{ numRuns: 2_000 }
		);
	});

	it('streams where the runtime has no one-shot hash', async () => {
		vi.resetModules();
		vi.doMock('node:crypto', async (real: () => Promise<typeof import('node:crypto')>) => ({
			...(await real()),
			hash: undefined
		}));
		try {
			const bare = await import('../src/server/fingerprint.ts');
			expect(bare.region_fingerprint).not.toBe(region_fingerprint);
			for (const canonical of ['', '{"a":1}', E_ACUTE + HIGH])
				expect(bare.region_fingerprint('/_app/x.js', canonical)).toBe(
					old_fingerprint('/_app/x.js', canonical)
				);
		} finally {
			vi.doUnmock('node:crypto');
			vi.resetModules();
		}
	});

	it('is the streaming hash of a long text', () => {
		const long = JSON.stringify({
			rows: Array.from({ length: 4000 }, (_, i) => ({ i, t: `${E_ACUTE}${i}` }))
		});
		expect(long.length).toBeGreaterThan(ONE_SHOT_MAX);
		expect(region_fingerprint('/_app/x.js', long)).toBe(old_fingerprint('/_app/x.js', long));
	});
});
