import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AkamaiEdge } from '../src/adapters/akamai.ts';
import { invalidate_tags, install, mark_handled, reset_for_tests } from '../src/registry.ts';
import server, { type PostrenderServerOptions } from '../src/server.ts';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { MemoryStore } from '../src/memory-store.ts';

const AKAMAI_TAG_RE = /^[A-Za-z0-9!#$%'+./^_`|~-]{1,128}$/;

describe('AkamaiEdge Golden Rules compliance', () => {
	const captured: { url: string; init: RequestInit }[] = [];
	beforeEach(() => {
		captured.length = 0;
		vi.stubGlobal('fetch', async (url: string | URL, init?: RequestInit) => {
			captured.push({ url: String(url), init: init ?? {} });
			return new Response(
				JSON.stringify({
					httpStatus: 201,
					purgeId: 'p-123',
					supportId: 's-456',
					detail: 'Request accepted'
				}),
				{ status: 201 }
			);
		});
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		reset_for_tests();
	});

	it('emits Akamai-legal Edge-Cache-Tag values (no colons, <=128 chars, <=128 tags) and merges app tags', () => {
		const edge = new AkamaiEdge({
			host: 'akab-test.purge.akamaiapis.net',
			clientToken: 'ct',
			clientSecret: 'cs',
			accessToken: 'at',
			site: 'https://www.example.com'
		});
		const headers = edge.headers({
			url: '/fr/fr/solar/',
			ttl: 3600,
			tags: ['cms-page-123', 'market-fr', 'invalid:colon']
		});
		const tags = (headers['edge-cache-tag'] ?? '')
			.split(',')
			.map((t) => t.trim())
			.filter(Boolean);
		expect(tags.length).toBeGreaterThan(0);
		expect(tags.length).toBeLessThanOrEqual(128);
		for (const t of tags) {
			expect(t).toMatch(AKAMAI_TAG_RE);
		}
		expect(tags).toContain('cms-page-123');
		expect(tags).toContain('market-fr');
		expect(tags).toContain('og_p/fr');
		expect(tags).toContain('og_p/fr/fr');
		expect(tags).toContain('og_p/fr/fr/solar');
	});

	it('defaults to Fast Purge DELETE for URL, prefix tag, and purgeTags', async () => {
		const audits: unknown[] = [];
		const edge = new AkamaiEdge({
			host: 'akab-test.purge.akamaiapis.net',
			clientToken: 'ct',
			clientSecret: 'cs',
			accessToken: 'at',
			site: 'https://www.example.com',
			onPurge: (entry) => audits.push(entry)
		});

		await edge.purgeUrl('/fr/fr/solar/');
		expect(captured[0].url).toContain('/ccu/v3/delete/url/production');

		await edge.purgeWhere({ prefix: '/fr/fr/' });
		expect(captured[1].url).toContain('/ccu/v3/delete/tag/production');
		expect(JSON.parse(String(captured[1].init.body))).toEqual({ objects: ['og_p/fr/fr'] });

		await (edge as unknown as { purgeTags(tags: string[]): Promise<void> }).purgeTags([
			'cms-page-1',
			's:file#fn:abc'
		]);
		expect(captured[2].url).toContain('/ccu/v3/delete/tag/production');
		const sent = JSON.parse(String(captured[2].init.body)) as { objects: string[] };
		for (const t of sent.objects) expect(t).toMatch(AKAMAI_TAG_RE);

		expect(audits).toHaveLength(3);
		expect(audits[0]).toMatchObject({
			method: 'delete',
			selector: 'url',
			httpStatus: 201,
			purgeId: 'p-123',
			supportId: 's-456'
		});
	});

	it('invalidate_tags uses purgeTags once instead of N purgeUrl calls', async () => {
		const edge = new AkamaiEdge({
			host: 'akab-test.purge.akamaiapis.net',
			clientToken: 'ct',
			clientSecret: 'cs',
			accessToken: 'at',
			site: 'https://www.example.com'
		});
		const store = new MemoryStore();
		const runtime = install({ store, edge: [edge] });
		await store.put(
			'/a',
			{ kind: 'page', html: '<p>a</p>', headers: {}, created: Date.now() },
			{ ttl: 60, tags: ['s:src:1'] }
		);
		await store.put(
			'/b',
			{ kind: 'page', html: '<p>b</p>', headers: {}, created: Date.now() },
			{ ttl: 60, tags: ['s:src:1'] }
		);

		await invalidate_tags(['s:src:1'], runtime);
		expect(captured).toHaveLength(1);
		expect(captured[0].url).toContain('/ccu/v3/delete/tag/production');
	});

	it('preserves SvelteKit load edge-cache-tag headers during postrender capture', async () => {
		const options: PostrenderServerOptions = { ttl: 60, default: true };
		const { ctx } = startPlugin(server, { name: '@ogygia/postrender', options });
		const edge = new AkamaiEdge({
			host: 'akab-test.purge.akamaiapis.net',
			clientToken: 'ct',
			clientSecret: 'cs',
			accessToken: 'at',
			site: 'https://www.example.com'
		});
		const runtime = install({ store: new MemoryStore(), edge: [edge] });
		const jar = { get: () => undefined, getAll: () => [], set: () => {}, delete: () => {} };
		const c = ctx(new Request('http://x.test/fr/fr/about-us/'), { cookies: jar as never });
		mark_handled(c.event, runtime);
		const res = new Response('<html><head></head><body>hi</body></html>', {
			headers: {
				'content-type': 'text/html',
				'edge-cache-tag': 'cms-page-42, market-fr'
			}
		});
		await server.page?.(c);
		const out = (await server.response?.(c, res)) ?? res;
		await server.done?.(c);
		const tagHeader = out.headers.get('edge-cache-tag') ?? '';
		expect(tagHeader).toContain('cms-page-42');
		expect(tagHeader).toContain('market-fr');
		expect(tagHeader).toContain('og_p/fr/fr');
	});

	it('refuses edge caching for variants when variants.header is omitted, and purges variant URLs by tag when set', async () => {
		const plain = new AkamaiEdge({
			host: 'akab-test.purge.akamaiapis.net',
			clientToken: 'ct',
			clientSecret: 'cs',
			accessToken: 'at',
			site: 'https://www.example.com'
		});
		expect(plain.headers({ url: '/', ttl: 60, variants: [['hero', 'bold']] })).toEqual({
			'cache-control': 'private, no-store'
		});
		await plain.purgeWhere({ prefix: '/' });
		expect(JSON.parse(String(captured[0].init.body))).toEqual({ objects: ['og_p'] });

		const keyed = new AkamaiEdge({
			host: 'akab-test.purge.akamaiapis.net',
			clientToken: 'ct',
			clientSecret: 'cs',
			accessToken: 'at',
			site: 'https://www.example.com',
			variants: { header: 'x-og-variants' },
			onPurge: () => {}
		});
		await keyed.purgeUrl('/fr/fr/landing');
		expect(captured[1].url).toContain('/ccu/v3/delete/tag/production');
		await keyed.purgeTags(['p:/fr/fr', 'b:v1']);
		expect(captured[2].url).toContain('/ccu/v3/delete/tag/production');
	});
});
