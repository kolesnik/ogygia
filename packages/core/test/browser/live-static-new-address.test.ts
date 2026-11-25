// A STATIC LIVE REGION WHOSE TICKS EACH COME AT A NEW ADDRESS. A live query's region carries its
// props in its endpoint, so a tick with new props is a new call: a new frame address. The island's
// decode of the tick (transport.ts) writes its HTML to the frame store at that address and hands the
// element the order it wrote it at (`written`). The element listens only to the address it bound
// first, so no one but the tick itself paints the new address's write: the store holding the tick's
// own write is no reason to drop it (only a newer write is). REGRESSION (apps/palaestra
// live-partial.spec, "static partial: value morphs to a new tick"): since island code and the runtime
// share one frame store (core's dist for both, e71e30a89), every tick after the first was dropped as
// 'older request' against its own write, and the badge stayed at its first value.
import { afterEach, expect, test } from 'vitest';
import { bootDev } from '../../src/runtime/full.ts';
import { _reset, stamp, write } from '../_frames.ts';
import { frameAddress, type FrameOrder } from '../../src/frame.ts';

type LiveRegion = HTMLElement & {
	applyLive(desc: {
		id: string;
		module: string;
		props: Record<string, unknown>;
		html: string;
		url: string;
		written?: FrameOrder;
	}): Promise<void>;
};

afterEach(() => {
	document.body.innerHTML = '';
	_reset();
});

const url_of = (n: number) =>
	`/__ogygia__?id=livenew0001&props=${btoa(JSON.stringify([{ value: n }]))}&exp=9999999999&sig=stub`;

/** A tick as island code hands it: written to the store at its address first, then applied. */
function tick(el: LiveRegion, n: number, version: number): Promise<void> {
	const url = url_of(n);
	const html = `<p data-tick>${n}</p>`;
	const order = { v: stamp(), d: version };
	write({ a: frameAddress(url), ...order, html });
	return el.applyLive({ id: 'livenew0001', module: '', props: {}, html, url, written: order });
}

test('each tick at a new address paints, though the store holds its own write', async () => {
	const el = document.createElement('ogygia-region') as LiveRegion;
	el.setAttribute('live', '');
	document.body.append(el);
	bootDev();
	await tick(el, 0, 1);
	expect(el.querySelector('[data-tick]')?.textContent).toBe('0');
	const node = el.querySelector('[data-tick]');
	await tick(el, 1, 2);
	expect(el.querySelector('[data-tick]')?.textContent).toBe('1');
	await tick(el, 2, 3);
	expect(el.querySelector('[data-tick]')?.textContent).toBe('2');
	expect(el.querySelector('[data-tick]'), 'morphed in place').toBe(node);
});

test('a tick whose address holds a newer write than its own still does not paint', async () => {
	const el = document.createElement('ogygia-region') as LiveRegion;
	el.setAttribute('live', '');
	document.body.append(el);
	bootDev();
	await tick(el, 0, 1);
	const url = url_of(5);
	const old = { v: stamp(), d: 2 };
	write({ a: frameAddress(url), v: stamp(), d: 3, html: '<p data-tick>newer</p>' });
	await el.applyLive({
		id: 'livenew0001',
		module: '',
		props: {},
		html: '<p data-tick>older</p>',
		url,
		written: old
	});
	expect(el.querySelector('[data-tick]')?.textContent).toBe('0');
});
