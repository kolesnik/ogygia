// THE ISLANDS ENDPOINT IS THE FRAMES FEATURE'S: a build whose feature word (ogygia:server/
// runtime-flags) has no region that streams HTML carries no endpoint. A request for it (a page from
// an earlier build, a request made by hand) answers 404 and the server says so once, with a code; a
// plugin's stitch of a hole keeps the hole's fallback. With the feature, the same requests render.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { HAS, set_server_word } from './_stubs/server.runtime-flags.ts';
import { F_FRAMES } from '../src/contract/features.ts';

vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));
vi.mock('ogygia:server/route-config', () => ({ route_config: {} }));
vi.mock('ogygia:server/devtools-boot-url', () => ({ devtools_boot_url: '' }));
const ID = 'abcdef012345';
vi.mock('ogygia:server/server-manifest', () => ({
	load_server_regions: async () => ({
		regions: { [ID]: async () => import('./_fixtures/Tiny.svelte') }
	}),
	region_url: { [ID]: '/x.js' },
	region_name: {},
	region_render: {},
	render_region: {},
	region_reads_page_data: null
}));
const stitched = vi.hoisted(() => ({ hole: '', html: undefined as string | null | undefined }));
vi.mock('ogygia:server/server-plugins', () => ({
	plugins: [
		{
			name: 'stitch',
			options: undefined,
			server: {
				async request(ctx: {
					event: { url: URL };
					renderHole(endpoint: string): Promise<string | null>;
				}) {
					if (ctx.event.url.pathname !== '/stored') return;
					stitched.html = await ctx.renderHole(stitched.hole);
					return new Response('stored');
				}
			}
		}
	]
}));

const { handle } = await import('../src/hooks.ts');
const { mint_server_region } = await import('../src/server/region-endpoint.ts');

const ALL = HAS;
const event = (url: string, init?: RequestInit) => {
	const u = new URL(url, 'https://app.test');
	return {
		url: u,
		request: new Request(u, init),
		getClientAddress: () => '1.2.3.4',
		cookies: { get: () => undefined },
		route: { id: null },
		params: {},
		isDataRequest: false,
		setHeaders() {},
		platform: undefined,
		locals: {}
	} as never;
};
const resolve = async () => new Response('page');
let logged: string[] = [];

beforeEach(() => {
	logged = [];
	stitched.html = undefined;
	const keep = (...a: unknown[]) => void logged.push(a.map(String).join(' '));
	vi.spyOn(console, 'warn').mockImplementation(keep);
	vi.spyOn(console, 'error').mockImplementation(keep);
});
afterEach(() => {
	set_server_word(ALL);
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
});

/** A hole, its batch, and a plugin's stitch of it, through one handle made for the word. */
async function ask_all(word: number) {
	set_server_word(word);
	const h = handle();
	const hole = mint_server_region(ID, {});
	stitched.hole = hole;
	const get = await h({ event: event(hole), resolve } as never);
	const batch = await h({
		event: event(hole.slice(0, hole.indexOf('?')), {
			method: 'POST',
			body: JSON.stringify([hole])
		}),
		resolve
	} as never);
	await h({ event: event('/stored'), resolve } as never);
	return { get, batch, stitch: stitched.html };
}

describe('the islands endpoint', () => {
	it('with the frames feature: a hole, its batch and a stitch render', async () => {
		vi.stubEnv('DEV', false);
		const { get, batch, stitch } = await ask_all(ALL);
		expect(get.status).toBe(200);
		expect(await get.text()).toContain('data-tiny');
		expect(batch.status).toBe(200);
		expect(await batch.text()).toContain('data-tiny');
		expect(stitch).toContain('data-tiny');
		expect(logged.filter((l) => l.includes('region_endpoint_unbuilt'))).toEqual([]);
	});

	it('without it: a hole and its batch answer 404, a stitch keeps its fallback, and the server says so once with a code', async () => {
		vi.stubEnv('DEV', false);
		const { get, batch, stitch } = await ask_all(ALL & ~F_FRAMES);
		expect(get.status).toBe(404);
		expect(batch.status).toBe(404);
		expect(stitch).toBe(null);
		expect(logged.filter((l) => l.includes('region_endpoint_unbuilt'))).toHaveLength(1);
	});
});
