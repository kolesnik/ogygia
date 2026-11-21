// THE SEED FIRST: a page's seed is the request memo's first root. The handle's page recorder walks
// page.data the first time a region records the page, and Region records its page ask before its
// island measures its props, so even the first island on the page (a header, whose 300 KB config
// the seed does not hold) is measured knowing the seed: its props say they cannot reach it
// (no F_SEED), and the document's plan never walks them.
import { afterEach, describe, expect, it } from 'vitest';
import { render } from 'svelte/server';
import type { Component } from 'svelte';
import { with_request_store } from '@sveltejs/kit/internal/server';
import { page } from '$app/state';
import { analysis, F_SEED } from '../src/seed-refs.ts';
import Region from '../src/Region.svelte';
import Tiny from './_fixtures/Tiny.svelte';
import KitPagePass from './_fixtures/KitPagePass.svelte';
import { region_props } from './_region-settings.ts';

const { handle } = await import('../src/hooks.ts');

const DOC = '<!doctype html><html><head><title>t</title></head><body><p>page</p></body></html>';
const region = Region as unknown as (r: unknown, p: unknown) => void;
const kit_pass = KitPagePass as unknown as Component<Record<string, unknown>>;

const island = (props: Record<string, unknown>) =>
	region_props({
		__mode: 'island',
		__entry: '/islands/tiny.js',
		__component: Tiny,
		__props: props,
		load: true
	});

/** One page request through the handle, its regions rendered where Kit renders the page. */
async function request(list: Record<string, unknown>[]): Promise<string> {
	const u = new URL('https://app.test/p');
	const event = {
		url: u,
		request: new Request(u),
		getClientAddress: () => '203.0.113.7',
		cookies: { get: () => undefined },
		route: { id: null },
		params: {},
		isDataRequest: false,
		setHeaders() {},
		platform: undefined,
		locals: {}
	};
	let html = '';
	await with_request_store({ event, state: {} } as never, () =>
		handle()({
			event: event as never,
			resolve: async (ev, opts) => {
				with_request_store({ event: { ...ev }, state: {} } as never, () => {
					const children = (renderer: unknown) => {
						for (const props of list) region(renderer, props);
					};
					void render(kit_pass, { props: { children } }).body;
				});
				html = (await opts!.transformPageChunk!({ html: DOC, done: true })) ?? '';
				return new Response(html, { headers: { 'content-type': 'text/html' } });
			}
		})
	);
	return html;
}

afterEach(() => {
	for (const k of Object.keys(page.data)) delete (page.data as Record<string, unknown>)[k];
});

describe('the seed walk · the seed first', () => {
	it("the first island's props, measured after the page's seed, say they cannot reach it", async () => {
		const block = { id: 'b', body: 'words '.repeat(60), rows: [{ sku: 'x'.repeat(120) }] };
		Object.assign(page.data, { catalog: { blocks: [block] } });
		const header = { config: { menus: [{ title: 'm'.repeat(150), items: ['i'.repeat(150)] }] } };
		const props = { block };
		const html = await request([island(header), island(props)]);
		expect(html).toContain('OgygiaSeedRef');
		const at = analysis(header).memo.nodes;
		expect(at.get(header)! & F_SEED).toBe(0);
		expect(at.get(header.config)! & F_SEED).toBe(0);
		expect(at.get(props)! & F_SEED).toBe(F_SEED);
	});
});
