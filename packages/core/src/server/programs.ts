/**
 * THE SERVER'S PROGRAMS: what a region's server render needs of the build's feature word (`HAS`,
 * the browser's word, `ogygia:server/runtime-flags`). A render the word leaves out is refused with a
 * code, so the server never writes into a page what the page's runtime cannot revive.
 */
import { HAS } from 'ogygia:server';
import { F_FRAMES, F_LAKES, F_LIVE } from '../contract/features.ts';
import { OgygiaError } from '../messages/server.ts';
import type { RegionArm } from '../region-plan.ts';

type Program = 'hole' | 'lake' | 'live';

const PROGRAM_BITS: Readonly<Record<Program, number>> = {
	hole: F_FRAMES,
	lake: F_LAKES,
	live: F_LIVE
};

/** The program each arm's server render writes for (`null`: one every build has). */
export const ARM_PROGRAMS: Readonly<Record<RegionArm, Program | null>> = {
	'island-inline': null,
	'island-shell': null,
	'hole-frozen': 'hole',
	'hole-adopt': 'hole',
	'hole-shell': 'hole',
	'lake-adopt': 'lake',
	'lake-children': 'lake',
	inline: null,
	dual: null,
	'live-baked': 'live',
	live: 'live',
	deferred: 'hole',
	promise: 'live',
	nothing: null
};

/** Refuses an arm whose program the build's word left out. */
export function need_program(arm: RegionArm, entry: string): void {
	const program = ARM_PROGRAMS[arm];
	if (program !== null && !(HAS & PROGRAM_BITS[program]))
		throw new OgygiaError('region_program_unbuilt', { entry, program });
}
