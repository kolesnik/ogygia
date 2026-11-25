// Test stub for `ogygia:server/runtime-flags` (the real one is the browser's word, generated from the
// app's marks by the compiler, link/runtime-entry.ts): every feature's server code kept, like the
// dev build.
import { FEATURE_BITS, feature_word, type FeatureName } from '../../src/contract/features.ts';
import { set_programs } from './region.programs.ts';

export let HAS: number = feature_word(Object.keys(FEATURE_BITS) as FeatureName[]);

/** TEST: render with another build's word (one whose marks leave a feature out), and its programs. */
export function set_server_word(word: number): void {
	HAS = word;
	set_programs(word);
}
