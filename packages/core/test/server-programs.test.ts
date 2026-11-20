// THE SERVER'S PROGRAMS: a server build carries a region's render only where the build's feature
// word (`ogygia:server/runtime-flags`, the browser's `HAS`) holds its program, so a server never
// writes into a page what the page's runtime cannot revive. Every kind of region the grid knows is
// rendered with each program left out of the word: a kind that needs it is refused with a code, a
// kind that does not renders exactly as with every program in.
import './_region-grid-devtools.ts';
import { afterEach, describe, expect, test, vi } from 'vitest';
import {
	cases_of,
	KINDS,
	PLACES,
	rejected_code,
	type GridCase,
	type Place
} from './_region-grid.ts';
import { server_out, type ServerOut } from './_region-grid-server.ts';
import { HAS, set_server_word } from './_stubs/server.runtime-flags.ts';
import { F_FRAMES, F_LAKES, F_LIVE } from '../src/contract/features.ts';

const arms_seen: string[] = [];
vi.mock('../src/server/programs.ts', async (real) => {
	const mod = await real<typeof import('../src/server/programs.ts')>();
	return {
		...mod,
		need_program: (arm: Parameters<typeof mod.need_program>[0], entry: string) => {
			arms_seen.push(arm);
			mod.need_program(arm, entry);
		}
	};
});

const ALL = HAS;
afterEach(() => {
	set_server_word(ALL);
	vi.unstubAllEnvs();
});

const PROGRAMS = [
	['hole', F_FRAMES],
	['lake', F_LAKES],
	['live', F_LIVE]
] as const;

/** What an arm's server render writes for the page's runtime: a deferred region's fetch (the hole
 *  program), a lake's, a held region's updates (live). */
function program_of_arm(arm: string): string | null {
	if (arm.startsWith('hole-') || arm === 'deferred') return 'hole';
	if (arm.startsWith('lake-')) return 'lake';
	return arm === 'live' || arm === 'live-baked' || arm === 'promise' ? 'live' : null;
}

/** The programs the regions of `c` (it and the ones its snippets place) render for. */
function full_render(c: GridCase, place: Place): { needs: Set<string>; out: ServerOut } {
	arms_seen.length = 0;
	set_server_word(ALL);
	const out = server_out(c, place);
	return { needs: new Set(arms_seen.map(program_of_arm).filter((p) => p !== null)), out };
}

/** Every eighth case of each kind, at the page and inside an island, in production. */
const SAMPLE = Object.keys(KINDS).flatMap((kind) => cases_of(kind).filter((_c, i) => i % 8 === 0));
const AT_PLACES = PLACES.filter(
	(p) => (p.at === 'page' || p.at === 'island') && p.env === 'prod' && p.page === 'ok'
);

describe('a region whose program the build left out', () => {
	for (const [program, bit] of PROGRAMS)
		test(`without the ${program} program: its regions are refused with a code, the rest render as with it`, () => {
			vi.stubEnv('DEV', false);
			const wrong: string[] = [];
			let refused = 0;
			for (const place of AT_PLACES)
				for (const c of SAMPLE) {
					const { needs, out: full } = full_render(c, place);
					set_server_word(ALL & ~bit);
					const out = server_out(c, place);
					const name = `${c.name} at=${place.at} kit=${place.kit} csr=${place.csr}`;
					if (needs.has(program)) {
						refused++;
						if (rejected_code(out.thrown) !== 'region_program_unbuilt')
							wrong.push(`${name}: not refused (${out.thrown ?? 'rendered'})`);
					} else if (out.text !== full.text) wrong.push(`${name}: rendered otherwise`);
				}
			expect(wrong.slice(0, 10)).toEqual([]);
			expect(refused).toBeGreaterThan(0);
		});

	test('the refusal names the region and its program', () => {
		set_server_word(ALL & ~F_FRAMES);
		const hole = cases_of('hole')[0];
		const out = server_out(hole, AT_PLACES[0]);
		expect(out.thrown).toMatch(/region_program_unbuilt/);
		expect(out.thrown).toMatch(/entry=hole-a/);
		expect(out.thrown).toMatch(/program=hole/);
	});
});
