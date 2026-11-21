import { server_plugin_count } from 'ogygia:server';
import { code_origins } from '../plugin/hooks.ts';

/** The code origins a page's runtime script names (plugin/hooks.ts `code_origins`). Only a plugin
 *  adds one, by its `codeOrigins` hook or the request's facts: a server built with none names none,
 *  and asks nothing on the request. */
export function page_code_origins(request?: Request): string[] {
	return server_plugin_count ? code_origins(request) : [];
}
