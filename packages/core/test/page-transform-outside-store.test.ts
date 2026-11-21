import { afterEach, describe, expect, it } from 'vitest';
import { getRequestEvent, with_request_store } from '@sveltejs/kit/internal/server';
import { set_request_event_stub } from './_stubs/server.request-event.ts';

const { handle } = await import('../src/hooks.ts');
const { record_page } = await import('../src/page-seed-registry.ts');

const DOC = '<!doctype html><html><head><title>t</title></head><body><p>page</p></body></html>';

const event_for = (u: URL) =>
	({
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
	}) as never as { request: Request; url: URL };

/** Asks for the request that Kit answered with its "no request" Error (each one builds an Error
 *  and its stack: ~4 µs on the request path). */
let refused = 0;
afterEach(() => {
	set_request_event_stub(null);
	refused = 0;
});

/** A page request exactly as Kit 2 runs it (runtime/server/respond.js): the handle inside the
 *  request store, `resolve` with the store CLEARED (`with_request_store(null, …)`), the render in a
 *  store of its own, and `transformPageChunk` after it, outside every store. */
async function page(render: () => void): Promise<string> {
	set_request_event_stub(() => {
		try {
			return getRequestEvent();
		} catch (error) {
			refused++;
			throw error;
		}
	});
	const event = event_for(new URL('https://app.test/p'));
	let html = '';
	await with_request_store({ event, state: {} } as never, () =>
		handle()({
			event: event as never,
			resolve: (ev, opts) =>
				with_request_store(null, async () => {
					with_request_store({ event: { ...ev }, state: {} } as never, render);
					refused = 0;
					html = (await opts!.transformPageChunk!({ html: DOC, done: true })) ?? '';
					return new Response(html, { headers: { 'content-type': 'text/html' } });
				})
		})
	);
	return html;
}

describe('the page transform Kit runs after it cleared its request store', () => {
	it('a page whose regions read no page data asks Kit for no request', async () => {
		const html = await page(() => record_page({ data: { a: 'AAA' } }, false));
		expect(html).not.toContain('AAA');
		expect(refused).toBe(0);
	});

	it('a page that ships a seed asks Kit for no request', async () => {
		const html = await page(() => record_page({ data: { a: 'AAA', b: 'BBB' } }, ['a']));
		expect(html).toContain('AAA');
		expect(html).not.toContain('BBB');
		expect(refused).toBe(0);
	});
});
