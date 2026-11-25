// A PAGE SEED WHOSE VISITOR LEFT (server/document-seeds.ts `ship_page_seed`): a router fetch of a
// page whose load streams settles the promises into the seed; when the visitor leaves while they
// settle, nobody reads the document, and the transform hands it back as Kit wrote it.
import { expect, it } from 'vitest';
import { with_request_store } from '@sveltejs/kit/internal/server';

const { handle } = await import('../src/hooks.ts');
const { record_page } = await import('../src/page-seed-registry.ts');

const DOC = '<!doctype html><html><head><title>t</title></head><body><p>page</p></body></html>';

it('a router fetch whose visitor leaves while its load settles gets the document as Kit wrote it', async () => {
	const left = new AbortController();
	const u = new URL('https://app.test/p');
	const event = {
		url: u,
		request: new Request(u, { signal: left.signal, headers: { 'x-ogygia-spa': '1' } }),
		getClientAddress: () => '203.0.113.7',
		cookies: { get: () => undefined },
		route: { id: null },
		params: {},
		isDataRequest: false,
		setHeaders() {},
		platform: undefined,
		locals: {}
	};
	let html: string | undefined;
	await with_request_store({ event, state: {} } as never, () =>
		handle()({
			event: event as never,
			resolve: async (ev, opts) => {
				with_request_store({ event: { ...ev }, state: {} } as never, () =>
					record_page({ data: { later: new Promise(() => {}) } }, 'all')
				);
				setTimeout(() => left.abort(), 5);
				html = (await opts!.transformPageChunk!({ html: DOC, done: true })) ?? '';
				return new Response(html, { headers: { 'content-type': 'text/html' } });
			}
		})
	);
	expect(html).toBe(DOC);
});
