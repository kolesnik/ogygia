// THE SERVER'S PROGRAMS: a server build carries a region's render only where the build's feature
// word (`ogygia:server/runtime-flags`, the browser's `HAS`) holds its program, so a server never
// writes into a page what the page's runtime cannot revive. Every kind of region the grid knows is
// rendered with each program left out of the word: a kind that needs it renders its waiting UI as
// static HTML (nothing the runtime revives) and says `region_program_unbuilt`, the page stays up; a
// kind that does not renders exactly as with every program in, and says nothing.
import './_region-grid-devtools.ts';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { cases_of, KINDS, PLACES, type GridCase, type Place } from './_region-grid.ts';
import { server_out, type ServerOut } from './_region-grid-server.ts';
import { HAS, set_server_word } from './_stubs/server.runtime-flags.ts';
import { F_FRAMES, F_LAKES, F_LIVE } from '../src/contract/features.ts';

const arms_seen: string[] = [];
vi.mock('../src/region-programs.ts', async (real) => {
	const mod = await real<typeof import('../src/region-programs.ts')>();
	return {
		...mod,
		unbuilt_program: (arm: Parameters<typeof mod.unbuilt_program>[0]) => {
			arms_seen.push(arm);
			return mod.unbuilt_program(arm);
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

/** The markup by which the page's runtime revives a region of each program: a hole's fetch (a
 *  shell's `render="defer"`, a frozen hole's element), a lake's element, a held region's updates. */
const REVIVED: Readonly<Record<string, RegExp>> = {
	hole: /render="defer"|<ogygia-region entry="hole-/,
	lake: /<ogygia-region entry="lake-a"/,
	live: /<ogygia-region live/
};

/** The HTML of the waiting UI a case renders in its region's place when its program is not built:
 *  a hole's fallback, a held region's placeholder or else its children; a lake has none. Only a
 *  text snippet's (a snippet holding a region renders that region). */
function waiting_html(c: GridCase): string | null {
	if (c.kind === 'lake') return null;
	if (c.kind === 'hole') return c.values.fallback === 'text' ? '<p>wait</p>' : null;
	if (c.values.placeholder === 'text') return '<p>wait</p>';
	if (c.values.placeholder === 'none' && c.values.children === 'text') return '<p>kid</p>';
	return null;
}

/** What the render said on the console (the grid keeps it), each call's arguments as text. */
function said(out: ServerOut): string[] {
	return JSON.parse(out.parts.said) as string[];
}

describe('a region whose program the build left out', () => {
	for (const [program, bit] of PROGRAMS)
		test(`without the ${program} program: its regions render their waiting UI as static HTML and say a code, the rest render as with it`, () => {
			vi.stubEnv('DEV', false);
			const wrong: string[] = [];
			let fell_back = 0;
			for (const place of AT_PLACES)
				for (const c of SAMPLE) {
					const { needs, out: full } = full_render(c, place);
					set_server_word(ALL & ~bit);
					const out = server_out(c, place);
					const errors = said(out);
					const name = `${c.name} at=${place.at} kit=${place.kit} csr=${place.csr}`;
					const unbuilt = errors.filter((e) => e.includes('region_program_unbuilt'));
					if (needs.has(program)) {
						fell_back++;
						if (out.thrown) wrong.push(`${name}: threw (${out.thrown})`);
						else if (REVIVED[program].test(out.body))
							wrong.push(`${name}: wrote markup the runtime revives: ${out.body}`);
						else if (waiting_html(c) !== null && !out.body.includes(waiting_html(c)!))
							wrong.push(`${name}: its waiting UI is missing: ${out.body}`);
						else if (!unbuilt.some((e) => e.includes(`program=${program}`)))
							wrong.push(`${name}: said no region_program_unbuilt (${errors.join(' | ')})`);
					} else if (out.text !== full.text) wrong.push(`${name}: rendered otherwise`);
					else if (unbuilt.length > 0) wrong.push(`${name}: said region_program_unbuilt`);
				}
			expect(wrong.slice(0, 10)).toEqual([]);
			expect(fell_back).toBeGreaterThan(0);
		}, 60_000);

	test('the code names the region and its program, and the page renders', () => {
		set_server_word(ALL & ~F_FRAMES);
		const hole = cases_of('hole').find((c) => c.values.fallback === 'text')!;
		const out = server_out(hole, AT_PLACES[0]);
		const errors = said(out);
		expect(out.thrown).toBeNull();
		expect(out.body).toContain('<p>wait</p>');
		expect(errors.filter((e) => e.includes('region_program_unbuilt'))).toHaveLength(1);
		expect(errors.join(' ')).toMatch(/entry=hole-a/);
		expect(errors.join(' ')).toMatch(/program=hole/);
	});

	test('a held region says it once per render, and each render says it again', () => {
		set_server_word(ALL & ~F_LIVE);
		const held = cases_of('deferred').find(
			(c) => c.values.html !== 'none' && c.values.placeholder === 'text'
		)!;
		for (let render = 0; render < 2; render++) {
			const out = server_out(held, AT_PLACES[0]);
			expect(out.body).toContain('<p>wait</p>');
			expect(said(out).filter((e) => /region_program_unbuilt.*program=live/.test(e))).toHaveLength(
				1
			);
		}
	});
});
