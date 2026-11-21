// ogygia's base-less URLs (`/_app/immutable/…`) through Kit's `asset()` on Kit 2 and Kit 3 without
// reading a version: Kit 2 throws on a path without its leading slash, Kit 3 warns on one with it.
// The first call tries it without; a Kit that refuses gets the slash from then on.
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
	vi.resetModules();
	vi.doUnmock('$app/paths');
});

async function with_kit(asset: (f: string) => string) {
	vi.doMock('$app/paths', () => ({ asset }));
	return (await import('../src/kit-paths.ts')).kit_asset;
}

describe('kit_asset', () => {
	it("Kit 3's form (no slash) where Kit takes it: never the slash it warns about", async () => {
		const seen: string[] = [];
		const kit_asset = await with_kit((f) => {
			seen.push(f);
			if (f.startsWith('/')) throw new Error('a Kit 3 dev warning would print here');
			return `/base/${f}`;
		});
		expect(kit_asset('/_app/immutable/x.js')).toBe('/base/_app/immutable/x.js');
		expect(kit_asset('/@id/ogygia:region/entry/a.js')).toBe('/base/@id/ogygia:region/entry/a.js');
		expect(seen.every((f) => !f.startsWith('/'))).toBe(true);
	});

	it("Kit 2's form (the slash) where Kit refuses the other: tried once, then the slash every time", async () => {
		const seen: string[] = [];
		const kit_asset = await with_kit((f) => {
			seen.push(f);
			if (!f.startsWith('/'))
				throw new Error('Cannot use `resolve(...)` with a non-absolute pathname');
			return `/base${f}`;
		});
		expect(kit_asset('/_app/immutable/x.js')).toBe('/base/_app/immutable/x.js');
		expect(kit_asset('/_app/immutable/y.js')).toBe('/base/_app/immutable/y.js');
		// one refused try, then straight to the slash
		expect(seen).toEqual(['_app/immutable/x.js', '/_app/immutable/x.js', '/_app/immutable/y.js']);
	});

	it('Kit 2 in a BUILD (no refusal: it returns the slash-less path page-relative) — still the slash', async () => {
		// REGRESSION (field report on 5c0e2c45): `asset('_site_/immutable/x.js')` answered
		// `_site_/immutable/x.js` in production, which a page at /account/ resolved to /account/_site_/…
		const kit_asset = await with_kit((f) => `${f}`);
		expect(kit_asset('/_site_/immutable/x.js')).toBe('/_site_/immutable/x.js');
		expect(kit_asset('/_site_/immutable/y.js')).toBe('/_site_/immutable/y.js');
	});

	it('the build’s Kit major decides with no probe at all', async () => {
		vi.stubGlobal('__OGYGIA_KIT_MAJOR__', 2);
		const seen: string[] = [];
		const kit2 = await with_kit((f) => (seen.push(f), `${f}`));
		expect(kit2('/_app/immutable/x.js')).toBe('/_app/immutable/x.js');
		expect(seen).toEqual(['/_app/immutable/x.js']);
		vi.resetModules();
		vi.stubGlobal('__OGYGIA_KIT_MAJOR__', 3);
		const kit3 = await with_kit((f) => `./${f}`);
		expect(kit3('/_app/immutable/x.js')).toBe('./_app/immutable/x.js');
		vi.unstubAllGlobals();
	});

	it('a value without a leading slash passes through as it is', async () => {
		const kit_asset = await with_kit((f) => `kit:${f}`);
		expect(kit_asset('already/relative.js')).toBe('kit:already/relative.js');
	});
});

describe('kit_asset within one request', () => {
	/** Kit 2's `asset()` with relative paths: the page's depth before the path, which `resolve` reads
	 *  as a route (a `(group)` segment and empty segments dropped, a `[param]` filled). */
	const kit2 = (depth: string, seen: string[]) => (f: string) => {
		seen.push(f);
		const route = `/${f
			.slice(1)
			.split('/')
			.filter((s) => s && !/^\([^)]+\)$/.test(s))
			.join('/')}`;
		return depth + route;
	};
	async function in_request(asset: (f: string) => string, rules = false) {
		vi.stubGlobal('__OGYGIA_KIT_MAJOR__', 2);
		vi.doMock('$app/paths', () => ({ asset }));
		const m = await import('../src/kit-paths.ts');
		const request = { id: 1 };
		const checked: Array<[string, string, string]> = [];
		m.set_asset_request_reader(
			() => request,
			rules ? (path, ours, kits) => void checked.push([path, ours, kits]) : null
		);
		return { kit_asset: m.kit_asset, checked, set: m.set_asset_request_reader };
	}
	afterEach(() => vi.unstubAllGlobals());

	it('asks Kit once per request, however many URLs, and answers what Kit answers', async () => {
		const seen: string[] = [];
		const { kit_asset, checked } = await in_request(kit2('../..', seen));
		const urls = ['/_app/immutable/a.js', '/_app/immutable/b.js', '/_app/immutable/a.js'];
		expect(urls.map(kit_asset)).toEqual(urls.map((u) => `../..${u}`));
		expect(seen).toEqual(['/_app']);
		expect(checked).toEqual([]);
	});

	it('another request asks Kit again: its page sits at another depth', async () => {
		const seen: string[] = [];
		let depth = '.';
		const { kit_asset, set } = await in_request((f) => kit2(depth, seen)(f));
		const one = {};
		const two = {};
		set(() => one);
		expect(kit_asset('/_app/x.js')).toBe('./_app/x.js');
		depth = '../../..';
		set(() => two);
		expect(kit_asset('/_app/x.js')).toBe('../../../_app/x.js');
		expect(seen).toEqual(['/_app', '/_app']);
	});

	it('a path Kit would read as more than a path is asked of Kit as it is', async () => {
		const seen: string[] = [];
		const { kit_asset } = await in_request(kit2('.', seen));
		expect(kit_asset('/(shop)/_app/x.js')).toBe('./_app/x.js');
		expect(kit_asset('/_app//x.js')).toBe('./_app/x.js');
		expect(kit_asset('/_app/[id]/x.js')).toBe('./_app/[id]/x.js');
		expect(seen).toEqual(['/(shop)/_app/x.js', '/_app//x.js', '/_app/[id]/x.js']);
	});

	it('a Kit whose answer is not a prefix and the path is asked for every URL', async () => {
		const seen: string[] = [];
		const { kit_asset } = await in_request((f) => (seen.push(f), `${f}?v=1`));
		expect(kit_asset('/_app/a.js')).toBe('/_app/a.js?v=1');
		expect(kit_asset('/_app/b.js')).toBe('/_app/b.js?v=1');
		expect(seen).toEqual(['/_app', '/_app/a.js', '/_app/b.js']);
	});

	it('outside a request every URL is asked of Kit', async () => {
		const seen: string[] = [];
		const { kit_asset, set } = await in_request(kit2('.', seen));
		set(() => null);
		kit_asset('/_app/a.js');
		kit_asset('/_app/a.js');
		expect(seen).toEqual(['/_app/a.js', '/_app/a.js']);
	});

	it("with rules on, each URL made from the prefix is checked against Kit's own", async () => {
		const seen: string[] = [];
		let base = '/base';
		const { kit_asset, checked } = await in_request((f) => (seen.push(f), base + f), true);
		expect(kit_asset('/_app/a.js')).toBe('/base/_app/a.js');
		base = '/moved';
		expect(kit_asset('/_app/b.js')).toBe('/base/_app/b.js');
		expect(checked).toEqual([
			['/_app/a.js', '/base/_app/a.js', '/base/_app/a.js'],
			['/_app/b.js', '/base/_app/b.js', '/moved/_app/b.js']
		]);
	});
});
