// Test stub for `ogygia:boot/hook-bits` (link/hooks.ts): a lazy chunk's hook is `1` exactly while a
// test hears it (./boot.hooks.ts `subscribe`), as a build's bit is where a realm subscribes.
import type { RuntimeHookName } from '../../src/contract/runtime-hooks.ts';

export let regionMount: 0 | 1 = 0;
export let regionHydrate: 0 | 1 = 0;
export let regionHydrated: 0 | 1 = 0;
export let regionMismatched: 0 | 1 = 0;
export let answerPlaced: 0 | 1 = 0;
export let regionUnmount: 0 | 1 = 0;
export let navStarted: 0 | 1 = 0;
export let navigated: 0 | 1 = 0;

/** TEST: the bits of the hooks `names` on, every other one off. */
export function set_hook_bits(names: readonly RuntimeHookName[]): void {
	const bit = (name: RuntimeHookName): 0 | 1 => (names.includes(name) ? 1 : 0);
	regionMount = bit('regionMount');
	regionHydrate = bit('regionHydrate');
	regionHydrated = bit('regionHydrated');
	regionMismatched = bit('regionMismatched');
	answerPlaced = bit('answerPlaced');
	regionUnmount = bit('regionUnmount');
	navStarted = bit('navStarted');
	navigated = bit('navigated');
}
