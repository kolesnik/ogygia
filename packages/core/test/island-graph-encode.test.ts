// The island graph's wire text (island-graph.ts `encode_island_graph`), its entries an ordinary
// object from `Object.fromEntries`: over generated graphs it is byte for byte the text of the
// null-prototype object it replaced (the old encoder, below, the oracle), keys that are array
// indexes, `__proto__` (an own key, never the prototype), quotes, lone surrogates and line
// separators included.
import { describe, expect, it } from 'vitest';
import { fc } from '@ogygia/config/sim';
import { encode_island_graph, type IslandGraphWire } from '../src/island-graph.ts';

function old_encode(
	graph: ReadonlyMap<string, readonly string[]>,
	locations?: ReadonlyMap<string, string>
): string {
	const h: string[] = [];
	const index = new Map<string, number>();
	const e: Record<string, number[]> = Object.create(null);
	for (const [entry, hrefs] of graph) {
		const ids: number[] = [];
		for (const href of hrefs) {
			let i = index.get(href);
			if (i === undefined) {
				i = h.length;
				h.push(href);
				index.set(href, i);
			}
			ids.push(i);
		}
		e[entry] = ids;
	}
	if (!locations?.size) return JSON.stringify({ h, e } satisfies IslandGraphWire);
	return JSON.stringify({ h, e, s: Object.fromEntries(locations) } satisfies IslandGraphWire);
}

const KEY = fc.oneof(
	fc.constantFrom(
		'./_app/immutable/entry/a.js',
		'/_app/og-region.1f850d3e.js',
		'__proto__',
		'constructor',
		'0',
		'7',
		'10',
		'01',
		'4294967294',
		'4294967295',
		'-1',
		'1.5',
		'"q"',
		'a\\b',
		' ',
		'\ud800',
		''
	),
	fc.string({ maxLength: 6 }),
	fc.nat({ max: 40 }).map(String)
);
const HREF = fc.oneof(
	fc.constantFrom('./_app/c/svelte.js', '/_app/c/dep.js', '"', '\ud83d', '</script>'),
	fc.string({ maxLength: 5 })
);
const GRAPH = fc
	.array(fc.tuple(KEY, fc.array(HREF, { maxLength: 6 })), { maxLength: 8 })
	.map((rows) => new Map(rows));
const LOCATIONS = fc.option(
	fc.array(fc.tuple(KEY, HREF), { maxLength: 5 }).map((rows) => new Map(rows)),
	{ nil: undefined }
);

describe('the island graph from an ordinary object', () => {
	it('is the text JSON.stringify made of the wire object', () => {
		fc.assert(
			fc.property(GRAPH, LOCATIONS, (graph, locations) => {
				expect(encode_island_graph(graph, locations)).toBe(old_encode(graph, locations));
			}),
			{ numRuns: 20_000 }
		);
	});
});
