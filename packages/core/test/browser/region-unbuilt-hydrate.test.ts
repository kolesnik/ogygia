// A REGION WHOSE PROGRAM THE BUILD LEFT OUT, HYDRATED (decision #32): the server renders its waiting
// UI as static HTML and says `region_program_unbuilt`; the browser, built from the same marks, makes
// the same choice, so wherever a browser hydrates a region (Kit's pass over a csr=true page, an
// island's hydrate of what is nested in it, a live snippet's body, a woken hole's answer) the server's
// nodes are kept, Svelte says nothing about hydration, and the page holds nothing of that program
// for the runtime to revive. Every case of each kind that can need a program, in production.
import { afterEach, beforeAll, describe, expect, test, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { cases_of } from '../_region-grid.ts';
import { HYDRATE_PLACES, define_region_element, hydrate_out } from './_region-grid-client.ts';
import { set_programs } from '../_stubs/region.programs.ts';
import { HAS } from '../_stubs/boot.runtime-flags.ts';
import { F_FRAMES, F_LAKES, F_LIVE } from '../../src/contract/features.ts';

const ALL = HAS;
const PROGRAMS = [
	['hole', F_FRAMES],
	['lake', F_LAKES],
	['live', F_LIVE]
] as const;
/** The markup by which the page's runtime revives a region of each program. */
const REVIVED: Readonly<Record<string, RegExp>> = {
	hole: /render="defer"|<ogygia-region entry="hole-/,
	lake: /<ogygia-region entry="lake-/,
	live: /<ogygia-region live/
};
const KINDS = ['hole', 'lake', 'deferred', 'promise'];

beforeAll(() => define_region_element());
afterEach(() => {
	set_programs(ALL);
	vi.unstubAllEnvs();
});

describe('a region whose program the build left out, hydrated', () => {
	for (const [program, bit] of PROGRAMS)
		test(`without the ${program} program: the server's waiting UI hydrates as is, and nothing of it is revived`, async () => {
			const word = ALL & ~bit;
			const broken: string[] = [];
			let unbuilt = 0;
			for (const kind of KINDS) {
				const cases = cases_of(kind, 'client');
				for (const place of HYDRATE_PLACES.filter((p) => p.client.env === 'prod')) {
					const ssr = await commands.region_grid_ssr(kind, place.server, word);
					vi.stubEnv('DEV', false);
					set_programs(word);
					for (const [i, c] of cases.entries()) {
						const server = ssr[i];
						expect(server.name).toBe(c.name);
						const name = `${c.name} at=${place.client.at} csr=${place.client.csr}`;
						if (server.thrown) {
							broken.push(`${name}: the server threw ${server.thrown}`);
							continue;
						}
						if (server.said.includes('region_program_unbuilt')) unbuilt++;
						const out = await hydrate_out(c, place.client, server);
						for (const p of out.problems) broken.push(`${name}: ${p}`);
						const after = (JSON.parse(out.text) as { body_after: string }).body_after;
						if (REVIVED[program].test(after))
							broken.push(`${name}: the page holds markup the runtime revives: ${after}`);
					}
				}
			}
			expect(broken.slice(0, 20)).toEqual([]);
			expect(unbuilt).toBeGreaterThan(0);
		}, 600_000);
});
