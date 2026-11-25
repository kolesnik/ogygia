// The `when` / `wake` / `prefetch` / `revalidate` vocabulary (src/contract/trigger.ts, #482): one
// parse into a tagged union, read by the compiler's checks and the runtime's schedules alike.
import { describe, expect, it, vi } from 'vitest';
import {
	is_media_query,
	on_schedule,
	on_trigger,
	parse_trigger,
	SCHEDULE,
	TRIGGER_ARMED,
	TRIGGER_MISSING,
	TRIGGER_UNKNOWN,
	WAKE
} from '../src/contract/trigger.ts';

describe('parse_trigger', () => {
	it('reads a keyword its set allows, and a media query, into one shape', () => {
		expect(parse_trigger('idle', WAKE)).toEqual({ on: 'idle' });
		expect(parse_trigger('interaction', WAKE)).toEqual({ on: 'interaction' });
		expect(parse_trigger('(min-width: 600px)', SCHEDULE)).toEqual({
			on: 'media',
			query: '(min-width: 600px)'
		});
	});

	it('refuses a keyword its set does not allow, and anything else', () => {
		expect(parse_trigger('interaction', SCHEDULE)).toBeNull();
		expect(parse_trigger('soon', WAKE)).toBeNull();
		expect(parse_trigger('', WAKE)).toBeNull();
	});

	it('a media query is media conditions and media words, never a call or unbalanced parentheses', () => {
		for (const q of [
			'(min-width: 600px)',
			'screen and (min-width: 600px)',
			'(min-width: 600px) and (max-width: 900px), print and (color)',
			'not all and (monochrome)',
			'(width >= calc(300px + 2em))',
			'(prefers-reduced-motion)'
		])
			expect(parse_trigger(q, WAKE), q).toEqual({ on: 'media', query: q });
		for (const q of [
			'visible(200px)',
			'idle()',
			'screen and(min-width: 1px)',
			'(min-width: 1px',
			')(',
			'soon (x)'
		])
			expect(parse_trigger(q, WAKE), q).toBeNull();
	});

	it('every media type CSS accepts is a media word, the deprecated ones too', () => {
		for (const type of [
			'speech',
			'tty',
			'tv',
			'projection',
			'handheld',
			'braille',
			'embossed',
			'aural'
		]) {
			const q = `${type} and (min-width: 600px)`;
			expect(parse_trigger(q, WAKE), q).toEqual({ on: 'media', query: q });
		}
	});
});

/** A media arm: arms a value (a spy) only when the real media query test holds it. */
const media_arm = () => vi.fn((value: string, _fire: () => void) => is_media_query(value));

describe('on_schedule', () => {
	const arms = () => ({ idle: vi.fn(), visible: vi.fn(), media: media_arm() });

	it('arms the schedule its value names', () => {
		const a = arms();
		const fire = vi.fn();
		expect(on_schedule('idle', a, fire)).toBe(TRIGGER_ARMED);
		expect(on_schedule('visible', a, fire)).toBe(TRIGGER_ARMED);
		expect(on_schedule('(max-width: 1px)', a, fire)).toBe(TRIGGER_ARMED);
		expect(a.idle).toHaveBeenCalledWith(fire);
		expect(a.visible).toHaveBeenCalledWith(fire);
		expect(a.media).toHaveBeenCalledWith('(max-width: 1px)', fire);
		expect(on_schedule('load', a, fire)).toBe(TRIGGER_ARMED);
		expect(fire).toHaveBeenCalledOnce();
	});

	it('a value no schedule takes (a hole fetched on interaction, cached as a lake) runs on load, never waits on matchMedia("interaction")', () => {
		const a = arms();
		const fire = vi.fn();
		expect(on_schedule('interaction', a, fire)).toBe(TRIGGER_UNKNOWN);
		expect(a.media).not.toHaveReturnedWith(true);
		expect(fire).toHaveBeenCalledOnce();
	});

	it('a schedule whose arm the build left out runs on load, and says it was missing', () => {
		const fire = vi.fn();
		expect(on_schedule('idle', { ...arms(), idle: null }, fire)).toBe(TRIGGER_MISSING);
		expect(fire).toHaveBeenCalledOnce();
	});
});

describe('on_trigger', () => {
	const arms = () => ({
		idle: vi.fn(),
		visible: vi.fn(),
		media: media_arm(),
		interaction: vi.fn(),
		load: vi.fn()
	});

	it('a wake arms its gesture, and its load through its own start', () => {
		const a = arms();
		const fire = vi.fn();
		expect(on_trigger('interaction', WAKE, a, fire)).toBe(TRIGGER_ARMED);
		expect(a.interaction).toHaveBeenCalledWith(fire);
		expect(on_trigger('load', WAKE, a, fire)).toBe(TRIGGER_ARMED);
		expect(a.load).toHaveBeenCalledWith(fire);
		expect(fire).not.toHaveBeenCalled();
	});

	it('a value that is not a trigger (a typo) runs on load and says so, never waits on matchMedia', () => {
		const a = arms();
		const fire = vi.fn();
		expect(on_trigger('visable', WAKE, a, fire)).toBe(TRIGGER_UNKNOWN);
		expect(a.media).not.toHaveReturnedWith(true);
		expect(a.load).toHaveBeenCalledWith(fire);
	});

	it.each([
		['idle', 'idle'],
		['visible', 'visible'],
		['media', '(min-width: 600px)']
	] as const)(
		'a trigger whose arm the build left out (%s) runs on load through its own start and says it was missing',
		(arm, when) => {
			const a = { ...arms(), [arm]: null };
			const fire = vi.fn();
			expect(on_trigger(when, WAKE, a, fire)).toBe(TRIGGER_MISSING);
			expect(a.load).toHaveBeenCalledWith(fire);
			expect(fire).not.toHaveBeenCalled();
		}
	);

	it('without the media arm, a value no keyword holds is missing (a media query or a typo, it cannot tell)', () => {
		const a = { ...arms(), media: null };
		const fire = vi.fn();
		expect(on_trigger('visable', WAKE, a, fire)).toBe(TRIGGER_MISSING);
		expect(a.load).toHaveBeenCalledWith(fire);
	});

	it('the arms a build kept still arm, whatever it left out beside them', () => {
		const a = { ...arms(), idle: null, media: null };
		const fire = vi.fn();
		expect(on_trigger('visible', WAKE, a, fire)).toBe(TRIGGER_ARMED);
		expect(on_trigger('interaction', WAKE, a, fire)).toBe(TRIGGER_ARMED);
		expect(on_trigger('load', WAKE, a, fire)).toBe(TRIGGER_ARMED);
		expect(a.visible).toHaveBeenCalledWith(fire);
		expect(a.interaction).toHaveBeenCalledWith(fire);
		expect(a.load).toHaveBeenCalledWith(fire);
	});

	it('a media query the media arm holds is armed, never also run on load', () => {
		const a = arms();
		const fire = vi.fn();
		expect(on_trigger('(min-width: 600px)', WAKE, a, fire)).toBe(TRIGGER_ARMED);
		expect(a.media).toHaveBeenCalledWith('(min-width: 600px)', fire);
		expect(a.load).not.toHaveBeenCalled();
	});
});
