// The `when` / `wake` / `prefetch` / `revalidate` vocabulary (src/contract/trigger.ts, #482): one
// parse into a tagged union, read by the compiler's checks and the runtime's schedules alike.
import { describe, expect, it, vi } from 'vitest';
import {
	is_media_query,
	on_schedule,
	on_trigger,
	parse_trigger,
	SCHEDULE,
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

/** A media arm: the real media query test, and a spy for its arming. */
const media_arm = () => ({ is: is_media_query, arm: vi.fn() });

describe('on_schedule', () => {
	const arms = () => ({ idle: vi.fn(), visible: vi.fn(), media: media_arm(), missing: vi.fn() });

	it('arms the schedule its value names', () => {
		const a = arms();
		const fire = vi.fn();
		on_schedule('idle', a, fire);
		on_schedule('visible', a, fire);
		on_schedule('(max-width: 1px)', a, fire);
		expect(a.idle).toHaveBeenCalledWith(fire);
		expect(a.visible).toHaveBeenCalledWith(fire);
		expect(a.media.arm).toHaveBeenCalledWith('(max-width: 1px)', fire);
		on_schedule('load', a, fire);
		expect(fire).toHaveBeenCalledOnce();
	});

	it('a value no schedule takes (a hole fetched on interaction, cached as a lake) runs on load, never waits on matchMedia("interaction")', () => {
		const a = arms();
		const fire = vi.fn();
		on_schedule('interaction', a, fire);
		expect(a.media.arm).not.toHaveBeenCalled();
		expect(fire).toHaveBeenCalledOnce();
	});
});

describe('on_trigger', () => {
	const arms = () => ({
		idle: vi.fn(),
		visible: vi.fn(),
		media: media_arm(),
		missing: vi.fn(),
		interaction: vi.fn(),
		load: vi.fn()
	});

	it('a wake arms its gesture, and its load through its own start', () => {
		const a = arms();
		const fire = vi.fn();
		expect(on_trigger('interaction', WAKE, a, fire)).toBe(true);
		expect(a.interaction).toHaveBeenCalledWith(fire);
		on_trigger('load', WAKE, a, fire);
		expect(a.load).toHaveBeenCalledWith(fire);
		expect(fire).not.toHaveBeenCalled();
	});

	it('a value that is not a trigger (a typo) runs on load and says so, never waits on matchMedia', () => {
		const a = arms();
		const fire = vi.fn();
		expect(on_trigger('visable', WAKE, a, fire)).toBe(false);
		expect(a.media.arm).not.toHaveBeenCalled();
		expect(a.load).toHaveBeenCalledWith(fire);
		expect(a.missing).not.toHaveBeenCalled();
	});

	it.each([
		['idle', 'idle'],
		['visible', 'visible'],
		['media', '(min-width: 600px)']
	] as const)(
		'a trigger whose arm the build left out (%s) goes to missing, never to its arm or a silent load',
		(arm, when) => {
			const a = { ...arms(), [arm]: null };
			const fire = vi.fn();
			expect(on_trigger(when, WAKE, a, fire)).toBe(true);
			expect(a.missing).toHaveBeenCalledWith(when, fire);
			expect(a.load).not.toHaveBeenCalled();
			expect(fire).not.toHaveBeenCalled();
		}
	);

	it('without the media arm, a value no keyword holds goes to missing (a media query or a typo, it cannot tell)', () => {
		const a = { ...arms(), media: null };
		const fire = vi.fn();
		expect(on_trigger('visable', WAKE, a, fire)).toBe(true);
		expect(a.missing).toHaveBeenCalledWith('visable', fire);
		expect(a.load).not.toHaveBeenCalled();
	});

	it('the arms a build kept still arm, whatever it left out beside them', () => {
		const a = { ...arms(), idle: null, media: null };
		const fire = vi.fn();
		on_trigger('visible', WAKE, a, fire);
		on_trigger('interaction', WAKE, a, fire);
		on_trigger('load', WAKE, a, fire);
		expect(a.visible).toHaveBeenCalledWith(fire);
		expect(a.interaction).toHaveBeenCalledWith(fire);
		expect(a.load).toHaveBeenCalledWith(fire);
		expect(a.missing).not.toHaveBeenCalled();
	});
});
