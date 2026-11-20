import type { FeatureName } from '../../../packages/core/src/contract/features.ts';

/** One of the runtime's optional programs (see {@link PROGRAMS}). */
export type Program = {
	name: string;
	feature: FeatureName | FeatureName[] | null;
	/** Held exactly in an app with pages Kit hydrates (`__OGYGIA_KIT_PAGES__`), not by a feature. */
	kit?: true;
	modules: string[];
	strings?: string[];
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
	// the region element's live program: a held region's ticks (its tick's event)
	{ name: 'live program', feature: ['frames', 'live'], modules: [], strings: ['ogygia:live'] },
	// a page's lakes: each one's settle machine and the visit's cache of their server DOM
	{ name: 'lake state', feature: 'lakes', modules: [], strings: ['lake cache'] },
	// the region element's calls into the lakes feature (the arm it hands a frozen region)
	{ name: 'lake calls', feature: 'lakes', modules: [], strings: ['fetch_revalidate'] },
	// the probe for a page Kit hydrates (its boot script), with ogygia's regions on it: mixed mode
	{ name: 'kit probe', feature: null, kit: true, modules: [], strings: ['__sveltekit_'] }
];
