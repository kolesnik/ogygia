// The server-region table of the server-manifest stub (server.server-manifest.ts): a module, as a
// built server's is. Each region's loader imports a region module of its own (-region.ts?id=…),
// which answers the module the bench or suite gave for that id.
export type Loader = () => Promise<{ default: unknown }>;

/** What each region id's module answers. */
export const given = new Map<string, Loader>();
export let regions: Record<string, Loader> = {};

/** The table answers `table`; settles once each region's module is loaded (a built server's are,
 *  after its first request: a bench counts the later ones). */
export function set_table(table: Record<string, Loader>): Promise<void> {
	given.clear();
	const next: Record<string, Loader> = {};
	for (const id of Object.keys(table)) {
		given.set(id, table[id]!);
		const url = `./server.server-manifest-region.ts?id=${encodeURIComponent(id)}`;
		next[id] = () =>
			import(url).then((m: { load: () => Promise<{ default: unknown }> }) => m.load());
	}
	regions = next;
	return Promise.all(Object.values(next).map((load) => load())).then(() => undefined);
}
