// A BATCH WHOSE VISITOR LEFT (server/islands-endpoint.ts `capability_parcel`, `render_component`).
// The batch's signal aborts when nobody reads its answer any more. A hole of it does no work the
// visitor will never see: before its stream starts nothing loads; a render refused for the leaving
// is no failure to say; an answer finished after the leaving is not shaped by the app's pass.
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('ogygia:server/sign', () => import('../src/server/hmac.ts'));
vi.mock('ogygia:server/route-config', () => ({ route_config: {} }));
vi.mock('ogygia:server/devtools-boot-url', () => ({ devtools_boot_url: '' }));

const { ID, hole, pass } = vi.hoisted(() => {
	/** The hole's module: each load is counted, and one can be held until the test lets it go. */
	const hole = {
		loads: 0,
		hold_at: 0,
		release: null as (() => void) | null,
		held: null as Promise<void> | null
	};
	const pass = { regions: [] as string[] };
	return { ID: 'abcdef0123bb', hole, pass };
});

vi.mock('ogygia:server/server-plugins', () => ({
	plugins: [
		{
			name: 'shaper',
			options: undefined,
			server: {
				pass: () => ({
					document: async (html: string) => ({ html, head: '', body: '' }),
					region: async (html: string) => {
						pass.regions.push(html);
						return html;
					}
				})
			}
		}
	],
	plugin_count: 1,
	measures: 0
}));
vi.mock('ogygia:server/server-manifest', () => ({
	load_server_regions: async () => ({
		regions: {
			[ID]: async () => {
				hole.loads++;
				if (hole.loads === hole.hold_at) await hole.held;
				return {
					default: ($$renderer: { push(s: string): void }) => $$renderer.push('<p>the hole</p>')
				};
			}
		}
	}),
	region_url: { [ID]: '/x.js' },
	region_name: {},
	region_render: {},
	render_region: {},
	region_reads_page_data: null
}));

const { handle } = await import('../src/hooks.ts');
const { mint_server_region } = await import('../src/server/region-endpoint.ts');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Holds the hole's module at its `nth` load (1: the props decode's, 2: the render's). */
function hold_load(nth: number): () => void {
	hole.hold_at = nth;
	let release!: () => void;
	hole.held = new Promise<void>((r) => (release = r));
	return release;
}

function batch(signal?: AbortSignal) {
	const u = new URL('/__ogygia__', 'https://app.test');
	const event = {
		url: u,
		request: new Request(u, {
			method: 'POST',
			body: JSON.stringify([mint_server_region(ID, {})]),
			headers: { 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
			signal
		}),
		getClientAddress: () => '198.51.100.4',
		cookies: { get: () => undefined },
		route: { id: null },
		params: {},
		isDataRequest: false,
		setHeaders() {},
		platform: undefined,
		locals: {}
	};
	return handle()({ event, resolve: async () => new Response('page') } as never);
}

afterEach(() => {
	hole.loads = 0;
	hole.hold_at = 0;
	hole.held = null;
	pass.regions.length = 0;
	vi.restoreAllMocks();
});

describe('a batch whose visitor left', () => {
	it('read to its end, its hole loads, renders and goes through the app’s pass', async () => {
		const res = await batch();
		expect(await res.text()).toContain('<p>the hole</p>');
		expect(hole.loads).toBe(2);
		expect(pass.regions).toEqual([expect.stringContaining('<p>the hole</p>')]);
	});

	it('left before its stream started: its hole’s module never loads', async () => {
		const left = new AbortController();
		left.abort();
		const res = await batch(left.signal);
		await res.body?.cancel();
		await sleep(20);
		expect(hole.loads).toBe(0);
		expect(pass.regions).toEqual([]);
	});

	it('left while its hole’s props decode: the render refused for it is not said as a failure', async () => {
		const said: string[] = [];
		vi.spyOn(console, 'warn').mockImplementation((...a: unknown[]) => void said.push(a.join(' ')));
		vi.spyOn(console, 'error').mockImplementation((...a: unknown[]) => void said.push(a.join(' ')));
		const release = hold_load(1);
		const res = await batch();
		await sleep(5);
		await res.body!.cancel();
		release();
		await sleep(20);
		expect(hole.loads).toBe(1);
		expect(said).toEqual([]);
	});

	it('left while its hole renders: the finished answer is not shaped by the app’s pass', async () => {
		const release = hold_load(2);
		const res = await batch();
		await sleep(5);
		expect(hole.loads).toBe(2);
		await res.body!.cancel();
		release();
		await sleep(20);
		expect(pass.regions).toEqual([]);
	});
});
