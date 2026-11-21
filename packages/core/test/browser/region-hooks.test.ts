// regionMount's event (runtime/region-hooks.ts): the region, its entry, and the files it runs from,
// each as a full URL. A `src` no URL parser takes is no script of the page: the event names the entry
// alone, and the mount is still told.
import { afterEach, expect, test } from 'vitest';
import { client_region_mount } from '../../src/runtime/region-hooks.ts';
import type { RegionMountEvent } from '../../src/contract/runtime-hooks.ts';
import { hear, hear_none } from '../_hooks.ts';

afterEach(() => hear_none());

const region = (attrs: Record<string, string>) => {
	const el = document.createElement('ogygia-region');
	for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
	return el;
};

test('a mount names the region’s entry and its own file, as full URLs', () => {
	const heard: RegionMountEvent[] = [];
	hear({ regionMount: (e) => void heard.push(e) });
	const el = region({ entry: '/src/a.svelte', src: '/_app/immutable/og-region.a.js' });
	client_region_mount(el);
	expect(heard).toEqual([
		{
			el,
			entry: '/src/a.svelte',
			urls: [
				new URL('/src/a.svelte', document.baseURI).href,
				new URL('/_app/immutable/og-region.a.js', document.baseURI).href
			]
		}
	]);
});

test('a file no URL parser takes is left out, and the mount is still told', () => {
	const heard: RegionMountEvent[] = [];
	hear({ regionMount: (e) => void heard.push(e) });
	client_region_mount(region({ entry: '/src/a.svelte', src: 'http://[' }));
	expect(heard.map((e) => e.urls)).toEqual([[new URL('/src/a.svelte', document.baseURI).href]]);
});

test('a region with no entry, or no realm hearing, tells nothing', () => {
	const heard: RegionMountEvent[] = [];
	hear({ regionMount: (e) => void heard.push(e) });
	client_region_mount(region({}));
	hear_none();
	client_region_mount(region({ entry: '/src/a.svelte' }));
	expect(heard).toEqual([]);
});
