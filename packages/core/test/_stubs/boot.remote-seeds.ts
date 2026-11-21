// Test stub for `ogygia:boot/remote-seeds` (the real one is generated from the app's marks by the
// compiler, link/runtime-entry.ts): the remote-seeds feature, like the dev build. A test can stand
// another one in (or take it out, `null`) with `set_remote_seeds`; the bindings are live.
import * as feature from '../../src/runtime/remote-seeds.ts';

export let remote_seeds: typeof feature = feature;
export let remote_seeds_on = true;

/** TEST: the hydrate core and the page feature read `value` from here on; `null`: a build without it. */
export function set_remote_seeds(value: typeof feature | null): void {
	remote_seeds = value ?? feature;
	remote_seeds_on = value !== null;
}
