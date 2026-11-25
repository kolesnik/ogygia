// A BUILD WITH FRAMES BUT NO HELD REGION: deferred holes or lakes stream HTML, but the app's marks
// select no `live` feature, so its feature word has F_FRAMES and no F_LIVE, and the region
// element's live program folds out of its boot (apps/palaestra/e2e/bundle-size.ts PROGRAMS, the
// Deferred and Frozen profiles). A live region there is left as the server wrote it, and says so with
// a code (the compiler missed its held region), and a hole still fetches and paints its answer.
import { afterAll, beforeAll, expect, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { HAS, set_feature_word } from '../_stubs/boot.runtime-flags.ts';
import { F_LIVE } from '../../src/contract/features.ts';
import { codes_during } from './_logged-errors.ts';

const ALL = HAS;
beforeAll(() => set_feature_word(ALL & ~F_LIVE));
afterAll(() => set_feature_word(ALL));

const ENDPOINT = '/__ogygia__?id=cafebabe0012&props=W3t9XQ&exp=9999999999&sig=stub';

test('a live region in a build with no held region applies no tick, and says so with a code', async () => {
	document.body.innerHTML = '<ogygia-region live><p id="first">first</p></ogygia-region>';
	bootDev();
	const region = document.querySelector('ogygia-region') as HTMLElement & {
		applyLive(desc: unknown): Promise<void>;
	};
	const codes = await codes_during(() =>
		region.applyLive({ id: 'x', module: '', props: {}, html: '<p id="tick">tick</p>' })
	);
	expect(document.querySelector('#first')).not.toBeNull();
	expect(document.querySelector('#tick')).toBeNull();
	expect(region.hasAttribute('render')).toBe(false);
	expect(codes).toEqual(['region_program_missing']);
});

test('a live region in a build with a held region applies its tick and says nothing', async () => {
	set_feature_word(ALL);
	try {
		document.body.innerHTML = '<ogygia-region live><p id="first">first</p></ogygia-region>';
		bootDev();
		const region = document.querySelector('ogygia-region') as HTMLElement & {
			applyLive(desc: unknown): Promise<void>;
		};
		const codes = await codes_during(() =>
			region.applyLive({ id: 'y', module: '', props: {}, html: '<p id="tick">tick</p>' })
		);
		expect(document.querySelector('#tick')).not.toBeNull();
		expect(codes).toEqual([]);
	} finally {
		set_feature_word(ALL & ~F_LIVE);
	}
});

test('a deferred region in a build with no held region still fetches and paints its answer', async () => {
	const real = window.fetch;
	window.fetch = async () =>
		new Response('<p id="answered">answered</p>', {
			status: 200,
			headers: { 'content-type': 'text/html' }
		});
	try {
		const codes = await codes_during(async () => {
			document.body.innerHTML = `<ogygia-region render="defer" when="load" endpoint="${ENDPOINT}"><p id="fallback">fallback</p></ogygia-region>`;
			bootDev();
			await expect
				.poll(() => document.querySelector('#answered') !== null, { timeout: 10_000 })
				.toBe(true);
		});
		expect(codes).toEqual([]);
	} finally {
		window.fetch = real;
	}
});
