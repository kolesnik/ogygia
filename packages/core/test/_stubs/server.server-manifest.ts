// Test stub for `ogygia:server/server-manifest` (the plugin's server-region table): no server regions,
// unless a bench or suite sets them (`set_server_regions`). As in a built server, the table is a module
// of its own and each region a module of its own, each reached by `import()`: a bench counts the
// loader's work where production pays it (server.server-manifest-table.ts, -region.ts).
import { set_table, type Loader } from './server.server-manifest-table.ts';

export const load_server_regions = (): Promise<{ regions: Record<string, Loader> }> =>
	import('./server.server-manifest-table.ts');
export const region_url: Record<string, string> = {};
/** Set the server regions the table answers, each with a loader and a client URL; settles once
 *  each region's module is loaded. */
export function set_server_regions(table: Record<string, Loader>): Promise<void> {
	for (const id of Object.keys(region_url)) delete region_url[id];
	for (const id of Object.keys(table)) region_url[id] = `/_app/immutable/entry/${id}.js`;
	return set_table(table);
}
export const region_name: Record<string, string> = {};
export const region_render: Record<string, string> = {};
export const render_region: Record<string, string> = {};
export const region_reads_page_data: Record<string, boolean> | null = null;
