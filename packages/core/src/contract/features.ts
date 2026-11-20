/**
 * THE BUILD'S FEATURE WORD. Each runtime feature (the compiler's `FEATURES`, link/runtime-entry.ts)
 * has one bit here; the compiler writes the word of the features an app's marks select as `HAS`
 * (`ogygia:boot`), and the runtime tests bits: `if (HAS & F_FRAMES)`. The word is a build constant,
 * so a test of a bit that is off folds, and so does the code only it reaches. Both sides read the
 * numbering from here, so they can never number a feature differently.
 *
 * @internal
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
	| 'context';

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
	context: F_CONTEXT
};

/** The word of the given features. */
export function feature_word(names: Iterable<FeatureName>): number {
	let word = 0;
	for (const name of names) word |= FEATURE_BITS[name];
	return word;
}
