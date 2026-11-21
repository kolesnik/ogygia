// The live program is a lazy chunk (runtime/live-program.ts), loaded by a held region's first tick.
// A tick keeps its place in the frame store's order from the moment its turn starts, not from when
// the program arrived: a frame written at its address while the program loads is the newer one.
import { afterEach, expect, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset, stamp, write } from '../_frames.ts';
import { frameAddress } from '../../src/frame.ts';

const text = (el: Element) => el.querySelector('[data-tick]')?.textContent;
const tick = (ms = 50) => new Promise((r) => setTimeout(r, ms));

type LiveRegion = HTMLElement & {
	applyLive(desc: {
		id: string;
		module: string;
		props: Record<string, unknown>;
		html: string;
		url?: string;
	}): Promise<void>;
};

afterEach(() => {
	document.body.innerHTML = '';
	_reset();
});

test('the first tick, while the live program loads, is older than a frame written meanwhile', async () => {
	const el = document.createElement('ogygia-region') as LiveRegion;
	el.setAttribute('live', '');
	document.body.append(el);
	bootDev();
	const url = '/__ogygia__?id=liveload0001&props=W3t9XQ&exp=9999999999&sig=stub';
	const first = el.applyLive({
		id: 'liveload0001',
		module: '',
		props: {},
		html: '<p data-tick>1</p>',
		url
	});
	write({ a: frameAddress(url), v: stamp(), html: '<p data-tick>2</p>' });
	await first;
	await expect.poll(() => text(el), { timeout: 2_000 }).toBe('2');
	await tick(100);
	expect(text(el), 'the newer frame stands').toBe('2');
});
