// A live region on a Kit-hydrated document whose Kit cannot start: the tick's HTML stands, nothing
// hydrates, and the live region goes back to rest without failing (Kit's wait said why). Its own
// file: Kit's failed boot file stays failed in this frame's module map.
import { afterEach, expect, inject, test, vi } from 'vitest';
import { observe } from '@ogygia/machine';
import { from_b64 } from './b64.ts';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';

const LABEL = '/test/browser/fixtures/Label.svelte';

type LiveRegion = HTMLElement & {
	applyLive(desc: {
		id: string;
		module: string;
		props: Record<string, unknown>;
		html: string;
		hydrate?: string;
	}): Promise<void>;
};

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = '';
	_reset();
});

test('a live region on a page whose Kit cannot start keeps its HTML, hydrates nothing and goes back to rest', async () => {
	const errors: string[] = [];
	vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => {
		errors.push(a.map(String).join(' '));
	});
	document.body.innerHTML =
		'<script>__sveltekit_lab = {};\nimport("/__og_missing__/entry/start.js").then(() => {});</script>';
	const live = document.createElement('ogygia-region') as LiveRegion;
	live.setAttribute('live', '');
	document.body.append(live);
	bootDev();
	const steps: string[] = [];
	const off = observe((name, from, to) => {
		if (name === 'live-region') steps.push(`${from?.kind} -> ${to?.kind}`);
	});
	try {
		await live.applyLive({
			id: 'live-kit-failed',
			module: LABEL,
			props: { text: 'swapped' },
			html: from_b64(inject('label_render_b64')).replace('one', 'swapped'),
			hydrate: 'load'
		});
		await expect
			.poll(() => errors.some((e) => e.includes('kit_boot_failed')), { timeout: 10_000 })
			.toBe(true);
		await expect.poll(() => steps.at(-1)).toBe('hydrating -> idle');
		await new Promise((r) => setTimeout(r, 200));
	} finally {
		off();
	}
	expect(live.textContent).toContain('swapped');
	expect(live.hasAttribute('data-hydrated')).toBe(false);
	expect(steps).not.toContain('hydrating -> live');
	expect(steps).not.toContain('hydrating -> failed');
});
