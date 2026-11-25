/**
 * THE SERVER'S WORD ON A REGION IT COULD NOT BUILD: a region whose program the build left out
 * (../region-programs.ts) renders its waiting UI, and the server says so, each time it renders one,
 * so the page stays up and the log names the region.
 *
 * @packageDocumentation
 */
import { OgygiaError } from '../messages/server.ts';
import type { Program } from '../region-programs.ts';

/** Says `region_program_unbuilt` for a region of `entry` that needs `program`. */
export function say_unbuilt(entry: string, program: Program): void {
	console.error(new OgygiaError('region_program_unbuilt', { entry, program }));
}
