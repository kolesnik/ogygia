// Test stub for `ogygia:region/programs` (the real one is generated from the app's marks on each leg,
// the compiler's link/runtime-entry.ts `generateProgramsSource`): every program kept, like the dev
// build.
import { F_FRAMES, F_LAKES, F_LIVE } from '../../src/contract/features.ts';

export let HAS_FRAMES = true;
export let HAS_LAKES = true;
export let HAS_LIVE = true;

/** TEST: render with another build's programs (the word's three bits). */
export function set_programs(word: number): void {
	HAS_FRAMES = (word & F_FRAMES) !== 0;
	HAS_LAKES = (word & F_LAKES) !== 0;
	HAS_LIVE = (word & F_LIVE) !== 0;
}
