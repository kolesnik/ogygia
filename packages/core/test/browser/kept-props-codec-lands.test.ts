// Its own file: the codec the boot loaded is module state shared by a file's tests.
import { expect, inject, test, vi } from 'vitest';
import { page } from 'vitest/browser';
import { writable } from 'svelte/store';
import { from_b64 } from './b64.ts';

// as a build whose marks left `wire` out: the hydrate core has every feature but the codec
vi.mock('../_stubs/boot.hydrate-features.ts', async (real: () => Promise<object>) => ({
	...(await real()),
	wire: null,
	wire_on: false
}));
// the moment the codec installs (its on-use load, ogygia:boot/runtime-flags `load_wire_codec`), which
// the test takes to bring newer props in
const installing = vi.hoisted(() => ({ hook: null as (() => void) | null }));
vi.mock('../_stubs/boot.runtime-flags.ts', async (real: () => Promise<object>) => ({
	...(await real()),
	load_wire_codec: () =>
		import('../../src/live-transport.ts').then((codec) => ({
			...codec,
			install(): void {
				codec.install();
				installing.hook?.();
			}
		}))
}));

const { bootDev } = await import('../../src/runtime/full.ts');
const { wire_codec } = await import('../../src/runtime/wire-on-use.ts');
const { stringify_props } = await import('../../src/server/props-wire.ts');

const LABEL = '/test/browser/fixtures/Label.svelte';
const HYDRATED = 'ogygia-region[data-hydrated]';
type Kept = Element & { absorbKeptProps(next: Element): void };

const kept = (body: string, props: Record<string, unknown>) =>
	`<ogygia-region wake="load" entry="${LABEL}" data-ogygia-keep="label">${body}</ogygia-region><script type="application/ogygia-props" data-ogygia-props>${stringify_props(props, 'Label')}\x3C/script>`;
const twin_of = (html: string) =>
	new DOMParser()
		.parseFromString(`<!doctype html><body>${html}</body>`, 'text/html')
		.querySelector('ogygia-region')!;

test('a kept island’s newer props that arrive as the wire codec installs win over the older ones that waited for it', async () => {
	const meta = document.createElement('meta');
	meta.name = 'ogygia-router';
	document.head.append(meta);
	const body = from_b64(inject('label_render_b64'));
	document.body.innerHTML = kept(body, { text: 'one' });
	bootDev();
	await expect
		.poll(() => document.querySelector(HYDRATED) !== null, { timeout: 10_000 })
		.toBe(true);
	const live = document.querySelector('ogygia-region') as Kept;
	const newer = twin_of(kept(body, { text: 'newer' }));
	installing.hook = () => live.absorbKeptProps(newer);

	live.absorbKeptProps(twin_of(kept(body, { text: 'older', extra: writable(7) })));
	await expect.poll(() => wire_codec(), { timeout: 10_000 }).toBeTruthy();
	await new Promise((r) => setTimeout(r, 100));
	await expect.element(page.getByTestId('label')).toHaveTextContent('newer');
});
