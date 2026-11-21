// Test stub for `ogygia:boot/hooks` (the real one is generated from the app's client realms by the
// compiler, link/hooks.ts). Like an app with no client realm, every hook is `0` until a test
// subscribes (test/_hooks.ts `hear`): then each hook it hears is the runtime's own `told`, which
// tells the realms the test handed the boot, and the lazy chunks' bits follow (./boot.hook-bits.ts).
import { told } from '../../src/runtime/hook-told.ts';
import type { LazyHooks, RuntimeHookName, RuntimeHooks } from '../../src/contract/runtime-hooks.ts';
import { set_hook_bits } from './boot.hook-bits.ts';

type Hook<K extends RuntimeHookName> = RuntimeHooks[K] | 0;

export let regionMount: Hook<'regionMount'> = 0;
export let regionUnmount: Hook<'regionUnmount'> = 0;
export let regionHydrate: Hook<'regionHydrate'> = 0;
export let answerParsed: Hook<'answerParsed'> = 0;
export let answerPlaced: Hook<'answerPlaced'> = 0;
export let regionHydrated: Hook<'regionHydrated'> = 0;
export let regionFailed: Hook<'regionFailed'> = 0;
export let regionWoke: Hook<'regionWoke'> = 0;
export let regionMismatched: Hook<'regionMismatched'> = 0;
export let holeAnswered: Hook<'holeAnswered'> = 0;
export let holeFailed: Hook<'holeFailed'> = 0;
export let holeBatchMissed: Hook<'holeBatchMissed'> = 0;
export let entryFallback: Hook<'entryFallback'> = 0;
export let reloadNeeded: Hook<'reloadNeeded'> = 0;
export let navStarted: Hook<'navStarted'> = 0;
export let navigated: Hook<'navigated'> = 0;
export let criticalSettled: Hook<'criticalSettled'> = 0;
export let loadStarted: Hook<'loadStarted'> = 0;
export let warning: Hook<'warning'> = 0;
/** (as an app with a plugin's browser half: the boot hands over the realms a test gives it) */
export const realm_count = 1;
/** One object for the whole run: the boot link holds it from its first fill. */
export const lazy_hooks: { -readonly [K in keyof LazyHooks]: LazyHooks[K] } = {};

/** TEST: the hooks `names` are heard (a build whose realms subscribe to them), no other one. */
export function subscribe(names: readonly RuntimeHookName[]): void {
	const on = <K extends RuntimeHookName>(name: K): Hook<K> =>
		names.includes(name) ? told(name) : 0;
	regionMount = on('regionMount');
	regionUnmount = on('regionUnmount');
	regionHydrate = on('regionHydrate');
	answerParsed = on('answerParsed');
	answerPlaced = on('answerPlaced');
	regionHydrated = on('regionHydrated');
	regionFailed = on('regionFailed');
	regionWoke = on('regionWoke');
	regionMismatched = on('regionMismatched');
	holeAnswered = on('holeAnswered');
	holeFailed = on('holeFailed');
	holeBatchMissed = on('holeBatchMissed');
	entryFallback = on('entryFallback');
	reloadNeeded = on('reloadNeeded');
	navStarted = on('navStarted');
	navigated = on('navigated');
	criticalSettled = on('criticalSettled');
	loadStarted = on('loadStarted');
	warning = on('warning');
	lazy_hooks.regionMount = regionMount || undefined;
	lazy_hooks.regionHydrate = regionHydrate || undefined;
	lazy_hooks.regionHydrated = regionHydrated || undefined;
	lazy_hooks.regionMismatched = regionMismatched || undefined;
	lazy_hooks.answerPlaced = answerPlaced || undefined;
	lazy_hooks.regionUnmount = regionUnmount || undefined;
	lazy_hooks.navStarted = navStarted || undefined;
	lazy_hooks.navigated = navigated || undefined;
	set_hook_bits(names);
}
