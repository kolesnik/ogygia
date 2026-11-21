// Test stub for `ogygia:boot/runtime-flags` (the real one is generated from the app's marks by
// the compiler, link/runtime-entry.ts): every feature's path kept, like the dev build. The codec's
// on-use load follows the word as the build writes it: `null` while the word holds `wire` (the
// hydrate core has the codec), the codec's import without it, so a test can take the codec out and
// watch a wake bring it back (test/browser/wire-on-use.test.ts).
import {
	FEATURE_BITS,
	F_WIRE,
	feature_word,
	type FeatureName
} from '../../src/contract/features.ts';

const codec_load = () => import('../../src/live-transport.ts');

export let HAS: number = feature_word(Object.keys(FEATURE_BITS) as FeatureName[]);
export let load_wire_codec: typeof codec_load | null = null;

/** TEST: boot with another build's word (one whose marks leave a feature out). */
export function set_feature_word(word: number): void {
	HAS = word;
	load_wire_codec = word & F_WIRE ? null : codec_load;
}
