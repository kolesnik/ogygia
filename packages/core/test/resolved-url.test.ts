// The runtime's one URL parse (runtime/resolved-url.ts) reads every pair exactly as `new URL` does,
// and keeps the answer: the island loads and preloads of a page ask the same pairs again and again.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolved_urls } from '../src/runtime/resolved-url.ts';

const resolve_url = (url: string, base?: string | null) => resolved_urls.resolve(url, base);
const g = globalThis as Record<string, unknown>;
let had_location: unknown;
beforeEach(() => {
	resolved_urls.forget();
	had_location = g.location;
	g.location = {
		href: 'https://site.test/a/b/page',
		origin: 'https://site.test'
	};
});
afterEach(() => {
	g.location = had_location;
	vi.restoreAllMocks();
});

const PAIRS: Array<[string, string | null | undefined]> = [
	['../x.js', 'https://site.test/a/b/page'],
	['./og-region.abc.js?v=1#h', 'https://cdn.test/build/'],
	['/root.js', undefined],
	['https://other.test/f.js', null],
	['//proto.test/rel.js', 'https://site.test/'],
	['data:text/javascript,1', null],
	['a\tb\nc.js', 'https://site.test/'],
	['../x.js', null],
	['http://[::1', null],
	['x.js', '']
];

describe('resolved_urls.resolve', () => {
	it.each(PAIRS)('reads %j against %j as new URL does', (url, base) => {
		let want: URL | null;
		try {
			want =
				base === null
					? new URL(url)
					: new URL(url, base === undefined ? 'https://site.test/a/b/page' : base);
		} catch {
			want = null;
		}
		const got = resolve_url(url, base);
		if (want === null) return expect(got).toBeNull();
		const { href, origin, protocol, pathname, search, hash } = got!;
		expect({ href, origin, protocol, pathname, search, hash }).toEqual({
			href: want.href,
			origin: want.origin,
			protocol: want.protocol,
			pathname: want.pathname,
			search: want.search,
			hash: want.hash
		});
	});

	it('parses a pair once, a failed one too', () => {
		const spy = vi.spyOn(globalThis, 'URL');
		resolve_url('./a.js', 'https://site.test/');
		resolve_url('./a.js', 'https://site.test/');
		expect(resolve_url('../x.js', null)).toBeNull();
		expect(resolve_url('../x.js', null)).toBeNull();
		expect(spy).toHaveBeenCalledTimes(2);
	});

	it('the page address is read at each ask: a navigation resolves against the new one', () => {
		expect(resolve_url('./x.js')?.href).toBe('https://site.test/a/b/x.js');
		(g.location as { href: string }).href = 'https://site.test/c/page';
		expect(resolve_url('./x.js')?.href).toBe('https://site.test/c/x.js');
	});

	it('no base and an empty base are different asks', () => {
		expect(resolve_url('https://site.test/f.js', null)?.href).toBe('https://site.test/f.js');
		expect(resolve_url('https://site.test/f.js', '')).toBeNull();
	});
});
