// A BUILD WITHOUT THE FRAMES FEATURE: no region of the app streams HTML (no deferred hole, no live
// region, no lake), so its feature word (`HAS`, ogygia:boot) has no F_FRAMES and the region
// element's hole and live programs fold out of its boot (apps/palaestra/e2e/bundle-size.ts PROGRAMS,
// the leak gate). What is left still wakes an island, and a region it has no program for is left as
// the server wrote it: no fetch, no tick applied. (The frames feature is installed here all the
// same, as bootDev installs every one: only the word keeps the programs from running.)
import { afterAll, afterEach, beforeAll, beforeEach, expect, inject, test } from 'vitest';
import { page } from 'vitest/browser';
import { from_b64 } from './b64.ts';
import { bootDev } from '../../src/runtime/full.ts';
import { HAS, set_feature_word } from '../_stubs/boot.runtime-flags.ts';
import { F_FRAMES } from '../../src/contract/features.ts';
import { mark_live_head } from './_response-mark.ts';

const ALL = HAS;
beforeAll(() => set_feature_word(ALL & ~F_FRAMES));
afterAll(() => set_feature_word(ALL));

const unmark: Array<() => void> = [];
beforeEach(() => void unmark.push(mark_live_head()));
afterEach(() => {
	for (const undo of unmark.splice(0)) undo();
});

const ENDPOINT = '/__ogygia__?id=cafebabe0011&props=W3t9XQ&exp=9999999999&sig=stub';

/** Every fetch the page makes while `run` runs (and a beat after), answered with HTML. */
async function fetches_during(run: () => Promise<void>): Promise<string[]> {
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
		await run();
		await new Promise((r) => setTimeout(r, 300));
	} finally {
		window.fetch = real;
	}
	return calls;
}

test('a load island wakes in a build without frames', async () => {
	document.body.innerHTML = from_b64(inject('counter_ssr_b64'));
	bootDev();
	await expect
		.poll(() => document.querySelector('ogygia-region[data-hydrated]') !== null, {
			timeout: 10_000
		})
		.toBe(true);
	await page.getByRole('button', { name: 'add' }).click();
	await expect.element(page.getByTestId('count')).toHaveTextContent('4');
});

test('a deferred region in a build without frames fetches nothing and keeps its fallback', async () => {
	const calls = await fetches_during(async () => {
		document.body.innerHTML = `<ogygia-region render="defer" when="load" endpoint="${ENDPOINT}"><p id="fallback">fallback</p></ogygia-region>`;
		bootDev();
	});
	expect(calls.filter((url) => url.includes('cafebabe0011'))).toEqual([]);
	expect(document.querySelector('#fallback')).not.toBeNull();
	expect(document.querySelector('#answered')).toBeNull();
});

test('a live region in a build without frames applies no tick', async () => {
	document.body.innerHTML = '<ogygia-region live><p id="first">first</p></ogygia-region>';
	bootDev();
	const region = document.querySelector('ogygia-region') as HTMLElement & {
		applyLive(desc: unknown): Promise<void>;
	};
	await region.applyLive({ id: 'x', module: '', props: {}, html: '<p id="tick">tick</p>' });
	expect(document.querySelector('#first')).not.toBeNull();
	expect(document.querySelector('#tick')).toBeNull();
	expect(region.hasAttribute('render')).toBe(false);
});
