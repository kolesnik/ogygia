/**
 * A REGION'S PROGRAM: what a region's render writes for in the page's runtime (a hole's fetch, a
 * lake's element, a held region's updates), and whether this build has it (`ogygia:region`'s three
 * bits, the same marks on the server and in the browser). A region whose program the build left
 * out renders its waiting UI as static HTML in both realms, so its hydration agrees and the runtime
 * finds nothing of it to revive.
 *
 * @packageDocumentation
 */
import { HAS_FRAMES, HAS_LAKES, HAS_LIVE } from 'ogygia:region';
import type { RegionArm } from './region-plan.ts';

/** A program a region's render can need. */
export type Program = 'hole' | 'lake' | 'live';

/** The program each arm's render writes for (`null`: one every build has). */
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

/** The program `arm` writes for when this build left it out, else `null`. */
export function unbuilt_program(arm: RegionArm): Program | null {
	const program = ARM_PROGRAMS[arm];
	if (program === null) return null;
	if (program === 'hole') return HAS_FRAMES ? null : program;
	if (program === 'lake') return HAS_LAKES ? null : program;
	return HAS_LIVE ? null : program;
}
