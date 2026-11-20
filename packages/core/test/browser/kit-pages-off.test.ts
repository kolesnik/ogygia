// A BUILD WHOSE ROUTES KIT HYDRATES NONE OF: the compiler proved every route csr=false (compiler
// kit.ts `kit_may_hydrate`), so `__OGYGIA_KIT_PAGES__` is false and the runtime's and island code's
// mixed-mode paths fold out (the Kit boot-script probe, the "is this island ours on a Kit page"
// guards). Such a runtime answers "Kit does not hydrate this page" without probing. A document whose
// server says Kit hydrates it all the same (`<meta name="ogygia-csr" content="true">`) is refused at
// boot with a code (kit-pages-refused.test.ts). The build's define is set before the runtime loads,
// as a build inlines it.
import { expect, inject, test } from 'vitest';
import { page } from 'vitest/browser';
import { from_b64 } from './b64.ts';
import { codes_during } from './_logged-errors.ts';

(globalThis as { __OGYGIA_KIT_PAGES__?: boolean }).__OGYGIA_KIT_PAGES__ = false;
const { bootDev } = await import('../../src/runtime/full.ts');
const { KIT_HYDRATES_KEY, kit_answer } = await import('../../src/wire-markup.ts');
const { runtime_session } = await import('../../src/runtime/session.ts');

test("an island wakes, and the runtime's answer is no, without probing the page", async () => {
	// (a Kit boot script and no csr meta: a runtime with Kit pages would probe and say yes)
	const kit = document.createElement('script');
	kit.textContent = 'window.__sveltekit_test = {};';
	document.body.append(kit);
	document.body.insertAdjacentHTML('afterbegin', from_b64(inject('counter_ssr_b64')));
	const codes = await codes_during(async () => {
		bootDev();
		await expect
			.poll(() => document.querySelector('ogygia-region[data-hydrated]') !== null, {
				timeout: 10_000
			})
			.toBe(true);
	});
	expect(codes).toEqual([]);
	expect(kit_answer()).toBe(false);
	expect(runtime_session.kit_page).toBeUndefined();
	expect(typeof (globalThis as unknown as Record<symbol, unknown>)[KIT_HYDRATES_KEY]).toBe(
		'function'
	);
	await page.getByRole('button', { name: 'add' }).click();
	await expect.element(page.getByTestId('count')).toHaveTextContent('4');
});

test("the page feature hands no wait for Kit's page: nothing in the app waits for one", async () => {
	const { install } = await import('../../src/runtime/seeds.ts');
	const { slots } = await import('../../src/runtime/slots.ts');
	// (Kit's bridge up, its page not applied yet: with Kit pages this is a real wait)
	const KIT_PAGE_KEY = Symbol.for('ogygia.kit-page');
	(globalThis as unknown as Record<symbol, unknown>)[KIT_PAGE_KEY] = { page: { status: -1 } };
	try {
		install();
		expect(slots.page?.kit_page_thread(new AbortController().signal)).toBeNull();
	} finally {
		delete (globalThis as unknown as Record<symbol, unknown>)[KIT_PAGE_KEY];
	}
});
