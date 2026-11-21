// Test stub for `ogygia:server/server-manifest` (the plugin's server-region table): no server regions,
// unless a bench or suite sets them (`set_server_regions`).
type Loader = () => Promise<{ default: unknown }>;
let regions: Record<string, Loader> = {};
export const load_server_regions = async (): Promise<{
	regions: Record<string, Loader>;
}> => ({ regions });
export const region_url: Record<string, string> = {};
/** Set the server regions the table answers, each with a loader and a client URL. */
export function set_server_regions(table: Record<string, Loader>): void {
	regions = table;
	for (const id of Object.keys(region_url)) delete region_url[id];
	for (const id of Object.keys(table)) region_url[id] = `/_app/immutable/entry/${id}.js`;
}
export const region_name: Record<string, string> = {};
export const region_render: Record<string, string> = {};
export const render_region: Record<string, string> = {};
export const region_reads_page_data: Record<string, boolean> | null = null;
