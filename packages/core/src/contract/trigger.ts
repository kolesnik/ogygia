/**
 * THE TRIGGER VOCABULARY (#482): when a region wakes, fetches, prefetches or revalidates is a
 * keyword (`load`, `idle`, `visible`, and for a wake or a swap `interaction`) or a media query.
 * It is parsed here once into a tagged union, by the compiler's checks and the runtime alike, and a
 * schedule is interpreted in one place (`on_schedule`).
 */

/** A parsed trigger. */
export type Trigger =
	| { readonly on: 'load' }
	| { readonly on: 'idle' }
	| { readonly on: 'visible' }
	| { readonly on: 'interaction' }
	| { readonly on: 'media'; readonly query: string };

export type TriggerKeyword = Exclude<Trigger['on'], 'media'>;

/** A schedule's keywords: a fetch, a prefetch, a revalidation (never `interaction`, a gesture). */
export const SCHEDULE: readonly TriggerKeyword[] = ['load', 'idle', 'visible'];
/** A wake's (and a hole's swap's) keywords: a schedule's, and `interaction`. */
export const WAKE: readonly TriggerKeyword[] = ['load', 'idle', 'visible', 'interaction'];

/** What may stand outside a media query's conditions: its words (every media type CSS accepts,
 *  the deprecated ones that never match too), commas and spaces. */
const MEDIA_WORDS_RE =
	/^(?:[\s,]|\b(?:and|or|not|only|all|screen|print|speech|tty|tv|projection|handheld|braille|embossed|aural)\b)*$/i;
/** A name character: one directly before a top-level `(` makes it a call, not a condition. */
const NAME_CHAR_RE = /[\w-]/;

/** True if `value` is a CSS media query: balanced parenthesized conditions joined by media words
 *  (`screen and (min-width: 600px)`), never a call like `visible(200px)` (test/trigger.test.ts). */
export function is_media_query(value: string): boolean {
	let depth = 0;
	let conditions = 0;
	let outside = '';
	for (let i = 0; i < value.length; i++) {
		const c = value[i]!;
		if (c === '(') {
			if (depth === 0) {
				if (i > 0 && NAME_CHAR_RE.test(value[i - 1]!)) return false;
				conditions++;
			}
			depth++;
		} else if (c === ')') {
			if (--depth < 0) return false;
		} else if (depth === 0) outside += c;
	}
	return depth === 0 && conditions > 0 && MEDIA_WORDS_RE.test(outside);
}

/** `value` as a trigger, when it is a keyword `allow` holds or a media query; else `null`. */
export function parse_trigger(value: string, allow: readonly TriggerKeyword[]): Trigger | null {
	if ((allow as readonly string[]).includes(value)) return { on: value as TriggerKeyword };
	if (is_media_query(value)) return { on: 'media', query: value };
	return null;
}

/**
 * How a schedule is armed: on idle, on screen, on a media query (a load runs at once). A build
 * leaves out the arms no region of its app is scheduled on (the `idle`, `visible` and `media`
 * features): such an arm is null, and a trigger that needs it runs on load and `on_trigger` returns
 * `TRIGGER_MISSING`. The media arm carries its own parse (it arms a value and returns true only
 * when the value is a media query), so a build without it ships no media parser; without it a
 * media query cannot be told from a typo, so every value no keyword holds is missing then.
 */
export interface ScheduleArms<F extends () => unknown = () => void> {
	idle: ((fire: F) => void) | null;
	visible: ((fire: F) => void) | null;
	media: ((value: string, fire: F) => boolean) | null;
}

/** `on_trigger` armed the value's trigger. */
export const TRIGGER_ARMED = 0;
/** `on_trigger` held no trigger in the value (a typo, or `interaction` where only a schedule is
 *  taken): it ran on load. */
export const TRIGGER_UNKNOWN = 1;
/** The value's trigger needs an arm the build left out (without the media arm: any value no
 *  keyword holds): `on_trigger` ran it on load. */
export const TRIGGER_MISSING = 2;
/** What `on_trigger` did with a value: armed it, or ran it on load and why. */
export type TriggerSaid = typeof TRIGGER_ARMED | typeof TRIGGER_UNKNOWN | typeof TRIGGER_MISSING;

/** How a wake is armed: a schedule's arms, a gesture's, and how a load starts (at once without one). */
export interface TriggerArms<F extends () => unknown = () => void> extends ScheduleArms<F> {
	interaction?: (fire: F) => void;
	load?: (fire: F) => void;
}

/**
 * Runs `fire` on the trigger `when` names, of those `allow` holds: the one interpreter of a trigger.
 * A value it does not hold runs on load: a typo (`visable`), or `interaction` where only a schedule
 * is taken (a hole fetched on a gesture carries it into its cached lake). Never a media query that
 * can never match (test/browser/wake-unknown-trigger.test.ts). A trigger whose arm the build left
 * out runs on load too (test/browser/schedules-missing.test.ts). Returns what it did, for the
 * caller to say: `TRIGGER_ARMED`, `TRIGGER_UNKNOWN` or `TRIGGER_MISSING`.
 */
export function on_trigger<F extends () => unknown>(
	when: string,
	allow: readonly TriggerKeyword[],
	arms: TriggerArms<F>,
	fire: F
): TriggerSaid {
	let said: TriggerSaid = TRIGGER_ARMED;
	if (!(allow as readonly string[]).includes(when)) {
		const media = arms.media;
		if (media?.(when, fire)) return TRIGGER_ARMED;
		said = media ? TRIGGER_UNKNOWN : TRIGGER_MISSING;
	} else if (when === 'idle' || when === 'visible') {
		const arm = arms[when];
		if (arm) {
			arm(fire);
			return TRIGGER_ARMED;
		}
		said = TRIGGER_MISSING;
	} else if (when === 'interaction' && arms.interaction) {
		arms.interaction(fire);
		return TRIGGER_ARMED;
	}
	if (arms.load) arms.load(fire);
	else fire();
	return said;
}

/** Runs `fire` on the schedule `when` names (a fetch, a prefetch, a revalidation): see `on_trigger`. */
export function on_schedule(when: string, arms: ScheduleArms, fire: () => void): TriggerSaid {
	return on_trigger(when, SCHEDULE, arms, fire);
}
