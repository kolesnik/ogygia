/**
 * AN ISLAND ENTRY'S LOAD, for a module both realms import (a region snippet boots its island in
 * the browser only). Imported as `#entry-load` (package.json `imports`): in the browser
 * `entry-load.browser.ts`, the runtime's own load; anywhere else (a server, plain Node) this
 * module, which loads nothing and imports nothing a plain Node process cannot.
 */
import { OgygiaError } from './messages/server.ts';

/** An island entry's load: the browser's (runtime/entry-locations.ts). The server loads none, as a
 *  snippet boots in the browser only: refused. */
export function import_entry<T>(entry: string, _url?: string): Promise<T> {
	return Promise.reject(new OgygiaError('entry_load_server_only', { entry }));
}
