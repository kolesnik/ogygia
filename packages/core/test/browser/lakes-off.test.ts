// A BUILD WITHOUT LAKES: no region of the app is frozen (`wake: 'none'`) or a lake, so its feature
// word (`HAS`, ogygia:boot) has no F_LAKES, the region element's calls into the lakes feature fold
// out, and the boot's link holds no lakes for the lazy chunks (src/runtime/boot-link.ts). A frozen
// region there stays as the server wrote it, and an island hydrates with no lake to hold.
import { afterAll, beforeAll, expect, inject, test } from 'vitest';
import { page } from 'vitest/browser';
import { from_b64 } from './b64.ts';
import { bootDev } from '../../src/runtime/full.ts';
import { HAS, set_feature_word } from '../_stubs/boot.runtime-flags.ts';
import { F_LAKES } from '../../src/contract/features.ts';
import { link_boot } from '../../src/runtime/boot-link.ts';
import {
	L_LAKE_HOLD,
	L_LAKE_RELEASE,
	L_LAKE_SETTLE_IN
} from '../../src/runtime/boot-link-index.ts';
import { errors_during } from './_logged-errors.ts';

const ALL = HAS;
beforeAll(() => set_feature_word(ALL & ~F_LAKES));
afterAll(() => set_feature_word(ALL));

test('a frozen region in a build without lakes stays as the server wrote it, and says nothing', async () => {
	const errors = await errors_during(async () => {
		document.body.innerHTML =
			'<ogygia-region wake="none" entry="frozen"><p id="frozen">frozen</p></ogygia-region>';
		bootDev();
		await new Promise((r) => setTimeout(r, 200));
	});
	const region = document.querySelector('ogygia-region')!;
	expect(document.querySelector('#frozen')).not.toBeNull();
	expect(region.hasAttribute('data-hydrated')).toBe(false);
	expect(errors).toEqual([]);
});

test('an island wakes in a build whose boot link holds no lakes', async () => {
	bootDev();
	const link = link_boot();
	expect([link[L_LAKE_HOLD], link[L_LAKE_RELEASE], link[L_LAKE_SETTLE_IN]]).toEqual([
		null,
		null,
		null
	]);
	document.body.innerHTML = from_b64(inject('counter_ssr_b64'));
	await expect
		.poll(() => document.querySelector('ogygia-region[data-hydrated]') !== null, {
			timeout: 10_000
		})
		.toBe(true);
	await page.getByRole('button', { name: 'add' }).click();
	await expect.element(page.getByTestId('count')).toHaveTextContent('4');
});
