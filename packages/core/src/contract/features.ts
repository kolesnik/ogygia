/**
 * THE BUILD'S FEATURE WORD. Each runtime feature (the compiler's `FEATURES`, link/runtime-entry.ts)
 * has one bit here; the compiler writes the word of the features an app's marks select as `HAS`
 * (`ogygia:boot`), and the runtime tests bits: `if (HAS & F_FRAMES)`. The word is a build constant,
 * so a test of a bit that is off folds, and so does the code only it reaches. Both sides read the
 * numbering from here, so they can never number a feature differently.
 *
 * @internal
 * @packageDocumentation
 */

/** A runtime feature's name (the compiler's `FeatureId`). */
export type FeatureName =
	| 'remote-seeds'
	| 'page'
	| 'wire'
	| 'wire-classes'
	| 'frames'
	| 'lakes'
	| 'morph'
	| 'live'
	| 'interaction'
	| 'forms'
	| 'mpa-nav'
	| 'router'
	| 'context'
	| 'idle'
	| 'visible'
	| 'media'
	| 'graph';

export const F_REMOTE_SEEDS = 0x1;
export const F_PAGE = 0x2;
export const F_WIRE = 0x4;
export const F_WIRE_CLASSES = 0x8;
/** Some region streams HTML (a deferred hole, a live region, a lake): the region element's fetch,
 *  apply and live paths. */
export const F_FRAMES = 0x10;
export const F_LAKES = 0x20;
export const F_MORPH = 0x40;
export const F_LIVE = 0x80;
export const F_INTERACTION = 0x100;
export const F_FORMS = 0x200;
export const F_MPA_NAV = 0x400;
export const F_ROUTER = 0x800;
export const F_CONTEXT = 0x1000;
/** Some region is scheduled on `idle` (a wake, a hole's fetch or prefetch, a lake's revalidation):
 *  the region element's idle arm. Without it, a region that asks for one says
 *  `region_schedule_missing` and runs on load. */
export const F_IDLE = 0x2000;
/** Some region is scheduled on `visible`: the region element's on-screen arm. */
export const F_VISIBLE = 0x4000;
/** Some region is scheduled on a media query: the media arm, and the parse that tells a media query
 *  from a typo. */
export const F_MEDIA = 0x8000;
/** Some island's code can load on the page: the island graph's reader (the preloads that start an
 *  island's chunks beside its import). Without it an island's import finds its chunks itself. */
export const F_GRAPH = 0x10000;

/** Each feature's bit, by its name. */
export const FEATURE_BITS: Readonly<Record<FeatureName, number>> = {
	'remote-seeds': F_REMOTE_SEEDS,
	page: F_PAGE,
	wire: F_WIRE,
	'wire-classes': F_WIRE_CLASSES,
	frames: F_FRAMES,
	lakes: F_LAKES,
	morph: F_MORPH,
	live: F_LIVE,
	interaction: F_INTERACTION,
	forms: F_FORMS,
	'mpa-nav': F_MPA_NAV,
	router: F_ROUTER,
	context: F_CONTEXT,
	idle: F_IDLE,
	visible: F_VISIBLE,
	media: F_MEDIA,
	graph: F_GRAPH
};

/** The word of the given features. */
export function feature_word(names: Iterable<FeatureName>): number {
	let word = 0;
	for (const name of names) word |= FEATURE_BITS[name];
	return word;
}
