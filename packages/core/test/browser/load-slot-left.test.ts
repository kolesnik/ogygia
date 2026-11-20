// A region taken off the page while its island code waits in the load scheduler's line: when the
// slot it asked for comes, it goes straight back, so the background window is not one place short
// for the rest of the page.
import { afterEach, beforeEach, expect, inject, test } from 'vitest';
import { observe } from '@ogygia/machine';
import { from_b64 } from './b64.ts';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset } from '../../src/runtime/frame-store.ts';
import {
	BACKGROUND_WINDOW,
	critical_settled,
	LoadSlot,
	reset_load_scheduler
} from '../../src/runtime/load-scheduler.ts';

const LABEL = '/test/browser/fixtures/Label.svelte';
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));

type LiveRegion = HTMLElement & {
	applyLive(desc: {
		id: string;
		module: string;
		props: Record<string, unknown>;
		html: string;
		hydrate?: string;
	}): Promise<void>;
};

/** Every place of the background window taken by a guess of its own: their releases, first first. */
async function fill_window(): Promise<Array<() => void>> {
	const releases: Array<() => void> = [];
	for (let i = 0; i < BACKGROUND_WINDOW; i++)
		void new LoadSlot({ kind: 'content', cls: 'speculative', label: `guess ${i}` }).ready.then(
			(release) => void releases.push(release)
		);
	await tick();
	expect(releases).toHaveLength(BACKGROUND_WINDOW);
	return releases;
}

/** Whether a background download asked for now starts once one guess is released. */
async function next_starts(releases: Array<() => void>): Promise<boolean> {
	let started = false;
	void new LoadSlot({ kind: 'content', cls: 'ahead', label: 'next' }).ready.then(() => {
		started = true;
	});
	releases[0]!();
	await tick(50);
	return started;
}

/** A box below the fold, so what wakes in it is `ahead`: background work. */
function below_the_fold(): HTMLElement {
	const box = document.createElement('div');
	box.style.cssText = `position:absolute;left:0;top:${innerHeight + 500}px;width:10px;height:10px`;
	document.body.append(box);
	return box;
}

beforeEach(async () => {
	reset_load_scheduler();
	await critical_settled();
});
afterEach(() => {
	document.body.innerHTML = '';
	_reset();
});

test('a live region taken off the page while its island code queues hands its load slot back when it comes', async () => {
	const releases = await fill_window();
	const live = document.createElement('ogygia-region') as LiveRegion;
	live.setAttribute('live', '');
	below_the_fold().append(live);
	bootDev();
	let hydrating = false;
	const off = observe((name, _from, to) => {
		if (name === 'live-region' && to?.kind === 'hydrating') hydrating = true;
	});
	try {
		void live.applyLive({
			id: 'live-left-in-line',
			module: LABEL,
			props: { text: 'queued' },
			html: from_b64(inject('label_render_b64')).replace('one', 'queued'),
			hydrate: 'load'
		});
		await expect.poll(() => hydrating).toBe(true);
		await tick(100);
		live.remove();
		await tick();
	} finally {
		off();
	}
	expect(await next_starts(releases)).toBe(true);
	expect(live.hasAttribute('data-hydrated')).toBe(false);
});

test('an island taken off the page while its code queues hands its load slot back when it comes', async () => {
	const releases = await fill_window();
	const box = below_the_fold();
	box.innerHTML = from_b64(inject('counter_ssr_b64'));
	const region = box.querySelector('ogygia-region')!;
	bootDev();
	await tick(100);
	region.remove();
	await tick();
	expect(await next_starts(releases)).toBe(true);
	expect(region.hasAttribute('data-hydrated')).toBe(false);
});
