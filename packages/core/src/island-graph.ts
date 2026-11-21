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
 *  not yet script-escaped): the text `JSON.stringify` makes of it, written directly (an object
 *  built key by key with no prototype is one V8 stringifies slowly; test/island-graph-encode.test.ts
 *  holds the two equal). */
export function encode_island_graph(
	graph: ReadonlyMap<string, readonly string[]>,
	locations?: ReadonlyMap<string, string>
): string {
	const h: string[] = [];
	const index = new Map<string, number>();
	const e: Array<[string, string]> = [];
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
		e.push([entry, `[${ids.join(',')}]`]);
	}
	const head = `{"h":${JSON.stringify(h)},"e":${json_object(e)}`;
	if (!locations?.size) return `${head}}`;
	const s: Array<[string, string]> = [];
	for (const [entry, src] of locations) s.push([entry, JSON.stringify(src)]);
	return `${head},"s":${json_object(s)}}`;
}

/** An object's JSON text from its keys, in the order given, and each value's JSON text: as
 *  `JSON.stringify` writes one, a key that is an array index (`"0"`, `"17"`) comes first, in
 *  ascending order. `rows` holds each key once. */
function json_object(rows: Array<[string, string]>): string {
	const named: string[] = [];
	let indexed: Array<[string, string]> | null = null;
	for (const row of rows) {
		if (is_index(row[0])) (indexed ??= []).push(row);
		else named.push(`${JSON.stringify(row[0])}:${row[1]}`);
	}
	if (indexed === null) return `{${named.join(',')}}`;
	indexed.sort((a, b) => Number(a[0]) - Number(b[0]));
	const first = indexed.map(([key, value]) => `"${key}":${value}`);
	return `{${first.concat(named).join(',')}}`;
}

/** An array index as a property key: a canonical whole number below 2^32 - 1. */
function is_index(key: string): boolean {
	const c = key.charCodeAt(0);
	if (!(c >= 48 && c <= 57) || key.length > 10) return false;
	if (c === 48) return key.length === 1;
	for (let i = 1; i < key.length; i++) {
		const d = key.charCodeAt(i);
		if (d < 48 || d > 57) return false;
	}
	return Number(key) < 4294967295;
}
