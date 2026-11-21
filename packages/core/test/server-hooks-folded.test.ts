// A SERVER BUILT WITHOUT A PLUGIN asks no shared hook on a request. The compiler writes, beside the
// server halves it imports (`ogygia:server/server-plugins`), how many there are and whether one
// implements `measures`: with none, a region answer never asks the plugins whether its visitor
// measures, and a document's runtime script adds no plugin's code origins. An implementation that
// turns up anyway (none can: only a plugin's server half registers one) is not asked.
import { describe, expect, it, vi } from 'vitest';

vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));
vi.mock('ogygia:server/rate-limit', () => ({ rate_limit: { max: 60, windowMs: 60_000 } }));
vi.mock('ogygia:server/server-plugins', () => ({ plugins: [], plugin_count: 0, measures: 0 }));
vi.mock('ogygia:server/router-config', () => ({ router_enabled: false, view_transitions: false }));
const ID = 'abcdef012345';
const Comp = ($$renderer: { push(s: string): void }) => $$renderer.push('<p>hole</p>');
vi.mock('ogygia:server/server-manifest', () => ({
	load_server_regions: async () => ({ regions: { [ID]: async () => ({ default: Comp }) } }),
	region_url: { [ID]: '/x.js' },
	region_name: {},
	region_render: {},
	render_region: {},
	region_reads_page_data: null
}));

const { handle } = await import('../src/hooks.ts');
const { mint_server_region } = await import('../src/server/region-endpoint.ts');
const { register_hooks } = await import('../src/plugin/hooks.ts');
const { page_code_origins } = await import('../src/server/page-code-origins.ts');
const { facts_of } = await import('../src/plugin/facts.ts');

function event(url: string) {
	const u = new URL(url, 'https://app.test');
	return {
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
	} as never;
}

describe('a server built without a plugin', () => {
	it('a region answer asks no plugin whether its visitor measures', async () => {
		vi.stubEnv('DEV', false);
		const asked = vi.fn(() => true);
		const leave = register_hooks({ measures: asked });
		try {
			const res = await handle()({
				event: event(mint_server_region(ID, {})),
				resolve: async () => new Response('page')
			} as never);
			expect(res.status).toBe(200);
			expect(res.headers.get('server-timing')).toBeNull();
			expect(asked).not.toHaveBeenCalled();
		} finally {
			leave();
			vi.unstubAllEnvs();
		}
	});

	it('a page with no router reads no learned code origin, and ships no runtime for one', async () => {
		const DOC =
			'<!doctype html><html><head><title>t</title></head><body><ogygia-region entry="https://peer.test/_app/ogygia/og-region.js" wake="load"><p>peer</p></ogygia-region></body></html>';
		let html = '';
		await handle()({
			event: { ...(event('/peer/q0') as object), route: { id: '/peer/[...rest]' } } as never,
			resolve: async (
				ev: { request: Request },
				opts: { transformPageChunk(o: object): Promise<string | undefined> }
			) => {
				facts_of(ev.request).codeOrigins = ['https://peer.test/_app/ogygia/runtime.js'];
				html = (await opts.transformPageChunk({ html: DOC, done: true })) ?? '';
				return new Response(html, { headers: { 'content-type': 'text/html' } });
			}
		} as never);
		expect(html).toContain('<p>peer</p>');
		expect(html).not.toContain('data-ogygia-runtime');
	});

	it('a document adds no plugin’s code origins, and reads no request’s', () => {
		const request = new Request('https://app.test/');
		(facts_of(request).codeOrigins ??= []).push('https://peer.example');
		const leave = register_hooks({ codeOrigins: () => ['https://other.example'] });
		try {
			expect(page_code_origins(request)).toEqual([]);
		} finally {
			leave();
		}
	});
});
