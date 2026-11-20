// Test stub for `ogygia:server/runtime-flags` (the real one is the browser's word, generated from the
// app's marks by the compiler, link/runtime-entry.ts): every feature's server code kept, like the
// dev build.
import {
	FEATURE_BITS,
	F_FRAMES,
	F_LAKES,
	F_LIVE,
	feature_word,
	type FeatureName
} from '../../src/contract/features.ts';

export let HAS: number = feature_word(Object.keys(FEATURE_BITS) as FeatureName[]);
export let HAS_FRAMES = true;
export let HAS_LAKES = true;
export let HAS_LIVE = true;

/** TEST: render with another build's word (one whose marks leave a feature out). */
export function set_server_word(word: number): void {
	HAS = word;
	HAS_FRAMES = (word & F_FRAMES) !== 0;
	HAS_LAKES = (word & F_LAKES) !== 0;
	HAS_LIVE = (word & F_LIVE) !== 0;
}
