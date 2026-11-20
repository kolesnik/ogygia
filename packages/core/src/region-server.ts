/**
 * THE SERVER'S HALF OF A REGION'S RENDER: what `Region.svelte`, `context.ts` and a region snippet
 * read on the server, from `ogygia:server` and the server helpers. They import it as
 * `#region-server` (package.json `imports`): on the server this module, in the browser
 * `region-server.browser.ts`, typed against it. The browser build never resolves `ogygia:server`
 * (the realm check refuses it), and the server never reaches the browser's entry loads.
 */
import { OgygiaError } from './messages/server.ts';
export {
	region_deps,
	region_css,
	region_css_inline,
	content_css,
	region_reads_page,
	region_page_keys,
	region_remotes,
	region_interactivity,
	entry_location,
	make_region_endpoint,
	mint_server_region,
	reuse_known_region,
	region_fingerprint,
	hole_css,
	get_request_event,
	csr_true_routes,
	error_csr_true_routes,
	root_layout_csr_true,
	HAS
} from 'ogygia:server';
export { runtime_bootstrap } from './server/entry-location.ts';
export { need_program } from './server/programs.ts';
export { region_css_tag, head_owner_attr } from './server/region-css.ts';
export { document_tail, island_graph_script, modulepreload_tag } from './server/document-tail.ts';

/** An island entry's load: the browser's (runtime/entry-locations.ts). The server loads none, as a
 *  snippet boots in the browser only: refused. */
export function import_entry<T>(entry: string, _url?: string): Promise<T> {
	return Promise.reject(new OgygiaError('entry_load_server_only', { entry }));
}
