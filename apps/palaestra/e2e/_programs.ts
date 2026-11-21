import type { FeatureName } from '../../../packages/core/src/contract/features.ts';

/** One of the runtime's optional programs (see {@link PROGRAMS}). */
export type Program = {
	name: string;
	feature: FeatureName | FeatureName[] | null;
	/** Held exactly in an app with pages Kit hydrates (`__OGYGIA_KIT_PAGES__`), not by a feature. */
	kit?: true;
	/** Held exactly in an app that lists this plugin's browser realm (a file the profile names,
	 *  ending so), not by a feature. */
	client?: string;
	modules: string[];
	strings?: string[];
	/** `hydrate`: the program rides the hydrate core (a hydrate-phase feature), so its modules are
	 *  in a lazy chunk exactly when its feature is selected, and never in the boot. */
	phase?: 'hydrate';
};

/**
 * The runtime's optional programs, each by the modules only it brings (a module's id as `modules`
 * names it). `feature`: the feature (the compiler's `FEATURES`) whose install brings the program
 * into the boot, so a profile's boot holds its modules exactly when its marks select that feature
 * (or every one of a list).
 * `null`: a program no boot holds (it lives in a lazy chunk, loaded on use), whatever the marks.
 * THE LEAK GATE (./bundle-size.ts): a program in a boot whose marks do not select it is a feature
 * that page pays for and never runs; one missing from a boot that selects it would leave the
 * server's markup with nothing to revive it. Both fail the run, in every mode. `strings`: for a
 * program that lives inside a shared module (the region element's), text only its code writes, read
 * in the boot's code (./plain-islands.spec.ts reads them in a real app's build too).
 */
export const PROGRAMS: readonly Program[] = [
	// the router's navigation and the soft refresh (lazy router-nav chunk): `stage`
	{ name: 'navigation', feature: null, modules: ['packages/machine/src/stage.ts'] },
	// a deferred region's fetch, and the server's record of the page's holes
	{
		name: 'holes',
		feature: 'frames',
		modules: [
			'packages/core/dist/runtime/hole-fetch.js',
			'packages/core/dist/runtime/hole-facts.js'
		]
	},
	// the region element's hole program: fetch, apply, revalidate, retry (its revalidated mark)
	{ name: 'hole program', feature: 'frames', modules: [], strings: ['data-revalidated'] },
	// the live program, a held region's ticks: the live feature's, its own lazy chunk (a first tick's)
	{
		name: 'live program',
		feature: 'live',
		phase: 'hydrate',
		modules: ['packages/core/dist/runtime/live-program.js']
	},
	// a page's lakes: each one's settle machine and the visit's cache of their server DOM
	{ name: 'lake state', feature: 'lakes', modules: [], strings: ['lake cache'] },
	// the region element's calls into the lakes feature (the arm it hands a frozen region)
	{ name: 'lake calls', feature: 'lakes', modules: [], strings: ['fetch_revalidate'] },
	// the option checks of flights, say and policy: every boot call's options are checked at build
	// (internal/macros options pass), so no boot holds them
	{
		name: 'option checks',
		feature: null,
		modules: [],
		strings: [
			'a list of the input fields that make the key',
			'a whole number of keys, 1 or more',
			'a share of 0 to 1'
		]
	},
	// what only flights() takes (a key of several fields, a world, a weigh): the router's page cache
	// is the one client flights that needs it, made in the lazy router-nav chunk; every boot flights
	// is plainFlights()
	{ name: 'full flights', feature: null, modules: ['packages/machine/src/flights-full.ts'] },
	// cache()'s ages, weights, pins and notices: the frame store's alone; every other boot cache is
	// lru()
	{ name: 'aging cache', feature: 'frames', modules: ['packages/machine/src/cache.ts'] },
	// a schedule's arm in the region element: each only where some region is scheduled on it
	{ name: 'idle arm', feature: 'idle', modules: ['packages/core/dist/runtime/arm-idle.js'] },
	{
		name: 'visible arm',
		feature: 'visible',
		modules: ['packages/core/dist/runtime/arm-visible.js']
	},
	{ name: 'media arm', feature: 'media', modules: ['packages/core/dist/runtime/arm-media.js'] },
	// the island graph's reader: only where some island's code can load
	{ name: 'island graph', feature: 'graph', modules: ['packages/core/dist/island-graph-read.js'] },
	// the probe for a page Kit hydrates (its boot script), with ogygia's regions on it: mixed mode
	{ name: 'kit probe', feature: null, kit: true, modules: [], strings: ['__sveltekit_'] },
	// @ogygia/rewrite's browser realm: only where the app lists the plugin
	{
		name: 'rewrite realm',
		feature: null,
		client: 'rewrite/dist/client.js',
		modules: ['packages/rewrite/dist/client.js', 'packages/rewrite/dist/host-classes.js']
	}
];
