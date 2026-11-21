import { afterEach, describe, expect, it, vi } from 'vitest';

const ID = 'abcdef012345';
const Comp = ($$renderer: { push(s: string): void }) => $$renderer.push('<p>hole</p>');
const counts = { table: 0, region: 0, fail: 0 };
vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));
vi.mock('ogygia:server/rate-limit', () => ({ rate_limit: { max: 100, windowMs: 60_000 } }));
vi.mock('ogygia:server/server-manifest', () => ({
	load_server_regions: async () => {
		counts.table++;
		return {
			regions: {
				[ID]: async () => {
					counts.region++;
					if (counts.fail > 0) {
						counts.fail--;
						throw new Error('the chunk is not there');
					}
					return { default: Comp };
				}
			}
		};
	},
	region_url: { [ID]: '/x.js' },
	region_name: {},
	region_render: {},
	region_reads_page_data: null,
	render_region: {}
}));

const { handle } = await import('../src/hooks.ts');
const { mint_server_region } = await import('../src/server/region-endpoint.ts');

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
const resolve = async () => new Response('page');

afterEach(() => {
	vi.unstubAllEnvs();
	vi.restoreAllMocks();
	counts.table = 0;
	counts.region = 0;
	counts.fail = 0;
});

describe("a hole request's server module", () => {
	it('a built server loads the region table and a region module once, however many requests', async () => {
		vi.stubEnv('DEV', false);
		const h = handle();
		for (let n = 0; n < 3; n++) {
			const res = await h({ event: event(mint_server_region(ID, { n })), resolve } as never);
			expect(res.status).toBe(200);
			expect(await res.text()).toContain('<p>hole</p>');
		}
		expect(counts).toEqual({ table: 1, region: 1, fail: 0 });
	});

	it('a region module that failed to load is loaded again by the next request', async () => {
		vi.stubEnv('DEV', false);
		vi.spyOn(console, 'warn').mockImplementation(() => {});
		vi.spyOn(console, 'error').mockImplementation(() => {});
		counts.fail = 1;
		const h = handle();
		const first = await h({ event: event(mint_server_region(ID, { n: 1 })), resolve } as never);
		expect(first.status).not.toBe(200);
		const second = await h({ event: event(mint_server_region(ID, { n: 2 })), resolve } as never);
		expect(second.status).toBe(200);
		expect(await second.text()).toContain('<p>hole</p>');
		// (the failed load, then the one the second request keeps for its render too)
		expect(counts.region).toBe(2);
	});

	it('a dev server imports the region again on every request (an edit replaces the module)', async () => {
		const h = handle();
		for (let n = 0; n < 2; n++) {
			const res = await h({ event: event(mint_server_region(ID, { n })), resolve } as never);
			expect(res.status).toBe(200);
		}
		expect(counts.region).toBeGreaterThanOrEqual(2);
		expect(counts.table).toBe(2);
	});
});
