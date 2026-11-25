// Test stub for `ogygia:boot/hydrate-features` (the real one is generated from the app's marks by
// the compiler, link/runtime-entry.ts): every hydrate-phase feature, like the dev build. A test can
// stand another build's feature in (or take one out, `null`) with `set_hydrate_feature`; the
// bindings are live, so the hydrate core reads the new one on its next call.
import * as seeds from '../../src/runtime/seeds.ts';
import * as live_transport from '../../src/live-transport.ts';
import * as live_feature from '../../src/runtime/live.ts';
import * as context_feature from '../../src/runtime/context.ts';

export let page: typeof seeds = seeds;
export let page_on = true;
export let wire: typeof live_transport = live_transport;
export let wire_on = true;
export let live: typeof live_feature = live_feature;
export let live_on = true;
export let context: typeof context_feature = context_feature;
export let context_on = true;

type Features = {
	page: typeof seeds;
	wire: typeof live_transport;
	live: typeof live_feature;
	context: typeof context_feature;
};

/** TEST: the hydrate core reads `value` for feature `name` from here on; `null`: a build without it. */
export function set_hydrate_feature<K extends keyof Features>(
	name: K,
	value: Features[K] | null
): void {
	const on = value !== null;
	if (name === 'page') [page, page_on] = [(value as typeof seeds) ?? seeds, on];
	else if (name === 'wire')
		[wire, wire_on] = [(value as typeof live_transport) ?? live_transport, on];
	else if (name === 'live') [live, live_on] = [(value as typeof live_feature) ?? live_feature, on];
	else [context, context_on] = [(value as typeof context_feature) ?? context_feature, on];
}

/** TEST: every hydrate-phase feature back, as the dev build has them. */
export function reset_hydrate_features(): void {
	[page, page_on, wire, wire_on] = [seeds, true, live_transport, true];
	[live, live_on, context, context_on] = [live_feature, true, context_feature, true];
}
