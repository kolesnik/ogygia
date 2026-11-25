// An interactive live tick on a page whose hydrate core cannot download: the failure is said, coded,
// and the tick ends quietly (nothing thrown at its caller). Its own file: the hydrate core's failed
// download stays in this frame's module map.
import { afterEach, expect, inject, onTestFinished, vi } from 'vitest';
import { commands } from 'vitest/browser';
import { PLAYWRIGHT, it_with_network_routes } from './_browsers.ts';
import { from_b64 } from './b64.ts';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		drop_downloads(path: string, times: number): Promise<void>;
		keep_downloads(path: string): Promise<void>;
	}
}

const CORE = '/src/runtime/hydrate-core.ts';
const LABEL = '/test/browser/fixtures/Label.svelte';
/** The dev runtime's guard against reloading a tab twice in a row (runtime/stale-deps.ts): set, a
 *  download that fails stays failed here instead of reloading the test's frame. */
const DEV_RELOADED_AT = 'ogygia:dev:dep-reload';

type LiveRegion = HTMLElement & {
	applyLive(desc: {
		id: string;
		module: string;
		props: Record<string, unknown>;
		html: string;
		hydrate?: string;
	}): Promise<void>;
};

afterEach(async () => {
	vi.restoreAllMocks();
	if (PLAYWRIGHT) await commands.keep_downloads(CORE);
	document.body.innerHTML = '';
	_reset();
});

it_with_network_routes(
	'a live tick whose hydrate core cannot download says so and ends quietly',
	async () => {
		sessionStorage.setItem(DEV_RELOADED_AT, String(Date.now()));
		onTestFinished(() => sessionStorage.removeItem(DEV_RELOADED_AT));
		await commands.drop_downloads(CORE, 50);
		const errors: string[] = [];
		vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
			errors.push(a.map(String).join(' '));
		});
		const live = document.createElement('ogygia-region') as LiveRegion;
		live.setAttribute('live', '');
		document.body.append(live);
		bootDev();
		await expect(
			live.applyLive({
				id: 'live-core-failed',
				module: LABEL,
				props: { text: 'tick' },
				html: from_b64(inject('label_render_b64')).replace('one', 'tick'),
				hydrate: 'load'
			})
		).resolves.toBeUndefined();
		expect(errors.filter((e) => e.includes('island_load_failed'))).toHaveLength(1);
		expect(live.hasAttribute('data-hydrated')).toBe(false);
	}
);
