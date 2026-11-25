// A hole answer's relative URLs as root paths (server/hole-urls.ts `RootPaths`), over generated
// inputs: every `./` or `../` value, plain or not, resolves to what the URL parser resolves it to
// against the endpoint request URL (its pathname, search and hash), or to null on another origin.
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { RootPaths } from '../src/server/hole-urls.ts';

/** What the parser says: the root path, or null when the value leaves the base's origin. */
function parsed(value: string, base: URL): string | null {
	const u = new URL(value, base);
	return u.origin === base.origin ? u.pathname + u.search + u.hash : null;
}

const SEGMENT_CHARS = [
	...'abcXYZ019_-.~!$&()*+,;=:@'.split(''),
	...`%'"<>\`{}^|[]\\ #?/`.split(''),
	'é',
	'\t',
	'\n'
];
const segment = fc.oneof(
	fc.constantFrom(
		'_app',
		'immutable',
		'entry',
		'x.js',
		'__ogygia__',
		'.',
		'..',
		'%2e',
		'.well-known'
	),
	fc.string({ unit: fc.constantFrom(...SEGMENT_CHARS), maxLength: 8 })
);
const path = fc.array(segment, { maxLength: 4 }).map((s) => s.join('/'));
const query = fc.oneof(
	fc.constant(''),
	fc.constant('?'),
	fc
		.string({ unit: fc.constantFrom(...'aZ09=&%?/:@-_.~\'"<> #'.split(''), '%2e'), maxLength: 10 })
		.map((q) => `?${q}`)
);
const value = fc
	.tuple(fc.constantFrom('./', '../', './../', './/'), path, query)
	.map(([lead, p, q]) => lead + p + q);
const base = fc
	.tuple(
		fc.constantFrom('https://app.test', 'http://localhost:5173', 'https://shop.example.test'),
		fc.array(fc.constantFrom('docs', 'a b', '%7E', 'guides', ''), { maxLength: 3 }),
		fc.constantFrom('__ogygia__', '', 'x/'),
		fc.constantFrom('', '?id=1&props=e30', '#h')
	)
	.map(([origin, dirs, last, tail]) => new URL(`${origin}/${[...dirs, last].join('/')}${tail}`));

describe("a hole answer's relative URLs as root paths", () => {
	it('every value resolves as the URL parser resolves it', () => {
		fc.assert(
			fc.property(value, base, (v, b) => {
				expect(new RootPaths(b).resolve(v)).toBe(parsed(v, b));
			}),
			{ numRuns: 20_000 }
		);
	});

	it('the URLs ogygia writes take the string path, and resolve against the endpoint directory', () => {
		const roots = new RootPaths(new URL('https://app.test/docs/__ogygia__?id=abc&props=e30'));
		expect(roots.resolve('./_app/immutable/entry/a.js')).toBe('/docs/_app/immutable/entry/a.js');
		expect(roots.resolve('./__ogygia__?id=d38bb964600c&props=W3t9XQ&exp=1&v=3&sig=ab&k=1')).toBe(
			'/docs/__ogygia__?id=d38bb964600c&props=W3t9XQ&exp=1&v=3&sig=ab&k=1'
		);
		expect(roots.resolve('../_app/x.js')).toBe('/_app/x.js');
		expect(roots.resolve('./a/../b.js')).toBe('/docs/b.js');
	});
});
