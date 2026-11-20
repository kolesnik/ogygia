// A BUILD WITHOUT LAKES: no region of the app is frozen (`wake: 'none'`) or a lake, so its feature
// word (`HAS`, ogygia:boot) has no F_LAKES, the region element's calls into the lakes feature fold
// out, and the lakes slot stays null (src/runtime/slots.ts): nothing installs it. A frozen region
// there stays as the server wrote it, as the slot's old no-op default left it, and an island
// hydrates with no lake to hold.
import { afterAll, afterEach, beforeAll, expect, inject, test } from 'vitest';
import { page } from 'vitest/browser';
import { from_b64 } from './b64.ts';
import { bootDev } from '../../src/runtime/full.ts';
import { HAS, set_feature_word } from '../_stubs/boot.runtime-flags.ts';
import { F_LAKES } from '../../src/contract/features.ts';
import { slots } from '../../src/runtime/slots.ts';
import { errors_during } from './_logged-errors.ts';

const ALL = HAS;
beforeAll(() => set_feature_word(ALL & ~F_LAKES));
afterAll(() => set_feature_word(ALL));

let lakes: typeof slots.lakes = null;
afterEach(() => {
	if (lakes) slots.lakes = lakes;
});

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

test('an island wakes in a build where nothing installed the lakes slot', async () => {
	bootDev();
	lakes = slots.lakes;
	slots.lakes = null;
	document.body.innerHTML = from_b64(inject('counter_ssr_b64'));
	await expect
		.poll(() => document.querySelector('ogygia-region[data-hydrated]') !== null, {
			timeout: 10_000
		})
		.toBe(true);
	await page.getByRole('button', { name: 'add' }).click();
	await expect.element(page.getByTestId('count')).toHaveTextContent('4');
});
