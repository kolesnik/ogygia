/**
 * THE ISLAND GRAPH — which chunks each island's code needs, as DATA the page carries, never as
 * `<link rel="modulepreload">` tags.
 *
 * An island entry's own `import()` finds its chunks only after it downloads and parses: a waterfall.
 * A modulepreload per chunk removes the waterfall, but a hint in the HTML fetches the moment the
 * parser meets it — before the page has painted, and for islands that may never wake. So the server
 * writes the graph as data (this format), and the runtime inserts the preload links itself when an
 * island WAKES (runtime/island-graph-preload.ts): after the wake gate, for exactly that island, beside
 * its `import()`. Its whole graph downloads in parallel the moment it may start; nothing lands in
 * the paint window; an island that never wakes downloads nothing.
 *
 * Wire shape (one inert JSON script): `{"h":[href,…],"e":{"<entry>":[i,…]},"s":{"<entry>":src}}` —
 * every chunk href once, each entry (the region's `entry` attribute, as emitted: its IDENTITY)
 * listing the indexes of the chunks it needs. Twenty islands sharing Svelte's client runtime name
 * its chunk once. `s` (optional): the LOCATION of an entry no element on the page carries — a
 * portable snippet's live entry, imported by its identity — so the runtime loads the content-hashed
 * file (runtime/region-endpoint-url.ts `note_entry_location`); an element carries its own (`src`).
 *
 * Universal leaf: the server encodes (server/document-tail.ts), the boot decodes (./island-graph-read.ts).
 */

/** The JSON shape a graph script carries. */
export interface IslandGraphWire {
	h: string[];
	e: Record<string, number[]>;
	s?: Record<string, string>;
}

/** Encode entry → chunk hrefs (and identity → location, when any) as the wire shape (JSON text,
 *  not yet script-escaped). The entries are an ordinary object made by `Object.fromEntries`, where
 *  an entry named `__proto__` is an own key like any other: an object with no prototype, built key
 *  by key, is one V8 stringifies slowly (test/island-graph-encode.test.ts holds the text equal). */
export function encode_island_graph(
	graph: ReadonlyMap<string, readonly string[]>,
	locations?: ReadonlyMap<string, string>
): string {
	const h: string[] = [];
	const index = new Map<string, number>();
	const rows: Array<[string, number[]]> = [];
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
		rows.push([entry, ids]);
	}
	const e = Object.fromEntries(rows) as IslandGraphWire['e'];
	if (!locations?.size) return JSON.stringify({ h, e } satisfies IslandGraphWire);
	return JSON.stringify({ h, e, s: Object.fromEntries(locations) } satisfies IslandGraphWire);
}
