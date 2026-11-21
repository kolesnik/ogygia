/**
 * THE ISLAND GRAPH'S READER (./island-graph.ts holds the wire shape and its writer): the boot reads
 * a page's graph (runtime/island-graph-preload.ts), and the islands endpoint a hole's
 * (server/hole-graph.ts). A server without holes holds none of it
 * (apps/palaestra/e2e/server-size.ts SERVER_PROGRAMS).
 */
import type { IslandGraphWire } from './island-graph.ts';

/** Decode a graph script's `s`: entry identity → location, as written (unresolved). */
export function decode_island_locations(text: string): Map<string, string> {
	const out = new Map<string, string>();
	let wire: IslandGraphWire;
	try {
		wire = JSON.parse(text) as IslandGraphWire;
		// oxlint-disable-next-line ogygia/no-silent-failures -- a graph only steers preloads; without it each entry loads by its own import
	} catch {
		return out;
	}
	if (!wire || !wire.s || typeof wire.s !== 'object') return out;
	for (const [entry, src] of Object.entries(wire.s))
		if (typeof src === 'string') out.set(entry, src);
	return out;
}

/** Decode a graph script's text: entry → chunk hrefs, as written (unresolved). Malformed → empty. */
export function decode_island_graph(text: string): Map<string, string[]> {
	const out = new Map<string, string[]>();
	let wire: IslandGraphWire;
	try {
		wire = JSON.parse(text) as IslandGraphWire;
		// oxlint-disable-next-line ogygia/no-silent-failures -- a graph only steers preloads; without it each entry loads by its own import
	} catch {
		return out;
	}
	if (!wire || !Array.isArray(wire.h) || !wire.e || typeof wire.e !== 'object') return out;
	for (const entry of Object.keys(wire.e)) {
		const ids = wire.e[entry];
		if (!Array.isArray(ids)) continue;
		const hrefs: string[] = [];
		for (const i of ids) {
			const href = wire.h[i];
			if (typeof href === 'string') hrefs.push(href);
		}
		out.set(entry, hrefs);
	}
	return out;
}
