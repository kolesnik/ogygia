// A BUILD WITHOUT A SCHEDULE'S ARM: no region of the app is scheduled on `idle`, `visible` or a media
// query, so its feature word (`HAS`, ogygia:boot) leaves that arm's bit out and the arm folds out of
// its boot (compiler test/schedule-features.test.ts says when). A region that asks for one anyway (HTML
// the compiler never saw) is never left unscheduled: it runs on load, and says so with a code. With the
// arm in, the same region keeps its schedule. (The word is switched per test, as a build would set it.)
import { afterAll, afterEach, beforeAll, expect, inject, test } from 'vitest';
import { from_b64 } from './b64.ts';
import { bootDev } from '../../src/runtime/full.ts';
import { HAS, set_feature_word } from '../_stubs/boot.runtime-flags.ts';
import { F_IDLE, F_MEDIA, F_VISIBLE } from '../../src/contract/features.ts';
import { errors_during } from './_logged-errors.ts';

const ALL = HAS;
beforeAll(() => set_feature_word(ALL));
afterEach(() => {
	set_feature_word(ALL);
	document.body.innerHTML = '';
});
afterAll(() => set_feature_word(ALL));

const NEVER = '(min-width: 99999px)';
const ENDPOINT = '/__ogygia__?id=cafebabe0012&props=W3t9XQ&exp=9999999999&sig=stub';

/** The counter island, scheduled on `wake`, below the fold (so `visible` is not met at once). */
function island(wake: string): Element {
	const box = document.createElement('div');
	box.style.cssText = `position:absolute;left:0;top:${innerHeight + 2000}px`;
	box.innerHTML = from_b64(inject('counter_ssr_b64')).replace('wake="load"', `wake="${wake}"`);
	document.body.append(box);
	return box.querySelector('ogygia-region')!;
}

/** Whether `region` comes alive within `ms`. */
async function wakes(region: Element, ms: number): Promise<boolean> {
	const until = performance.now() + ms;
	while (performance.now() < until) {
		if (region.hasAttribute('data-hydrated')) return true;
		await new Promise((r) => setTimeout(r, 50));
	}
	return region.hasAttribute('data-hydrated');
}

test.each<[string, number, string]>([
	['idle', F_IDLE, 'idle'],
	['visible', F_VISIBLE, 'visible'],
	['a media query', F_MEDIA, NEVER]
])('an island on %s in a build without its arm wakes on load and says so', async (_, bit, wake) => {
	set_feature_word(ALL & ~bit);
	let woke = false;
	const errors = await errors_during(async () => {
		const region = island(wake);
		bootDev();
		woke = await wakes(region, 10_000);
	});
	expect(woke).toBe(true);
	expect(errors.filter((e) => e.startsWith('region_schedule_missing'))).toHaveLength(1);
	expect(errors.find((e) => e.startsWith('region_schedule_missing'))).toContain(wake);
});

test.each<[string, string]>([
	['visible', 'visible'],
	['a media query that never matches', NEVER]
])('with its arm in, an island on %s keeps its schedule and says nothing', async (_, wake) => {
	let woke = true;
	const errors = await errors_during(async () => {
		const region = island(wake);
		bootDev();
		woke = await wakes(region, 1_500);
	});
	expect(woke).toBe(false);
	expect(errors.filter((e) => e.startsWith('region_schedule_missing'))).toEqual([]);
});

test('without the media arm, a value no trigger holds is said as a missing schedule, not twice', async () => {
	set_feature_word(ALL & ~F_MEDIA);
	const warns: string[] = [];
	const real = console.warn;
	console.warn = (...a: unknown[]) => void warns.push(a.map(String).join(' '));
	let woke = false;
	try {
		const errors = await errors_during(async () => {
			const region = island('visable');
			bootDev();
			woke = await wakes(region, 10_000);
		});
		expect(errors.filter((e) => e.startsWith('region_schedule_missing'))).toHaveLength(1);
	} finally {
		console.warn = real;
	}
	expect(woke).toBe(true);
	expect(warns.filter((w) => w.includes('region_wake_unknown'))).toEqual([]);
});

test('a hole fetched on idle in a build without the idle arm fetches on load and says so', async () => {
	set_feature_word(ALL & ~F_IDLE);
	const calls: string[] = [];
	const real = window.fetch;
	window.fetch = async (input) => {
		calls.push(String(input));
		return new Response('<p id="answered">answered</p>', {
			status: 200,
			headers: { 'content-type': 'text/html' }
		});
	};
	try {
		const errors = await errors_during(async () => {
			document.body.innerHTML = `<ogygia-region render="defer" when="idle" entry="late" endpoint="${ENDPOINT}"><p id="fallback">fallback</p></ogygia-region>`;
			bootDev();
			await expect.poll(() => document.querySelector('#answered') !== null).toBe(true);
		});
		expect(errors.filter((e) => e.startsWith('region_schedule_missing'))).toHaveLength(1);
	} finally {
		window.fetch = real;
	}
	expect(calls.some((url) => url.includes('cafebabe0012'))).toBe(true);
});
