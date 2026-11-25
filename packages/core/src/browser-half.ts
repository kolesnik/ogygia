/**
 * THE BROWSER'S HALF of a module both realms import: the work a region snippet does in the browser
 * alone (its island entry's load, the `{@html}` range marks taken out before it hydrates). Imported
 * as `#browser-half` (package.json `imports`): in the browser `browser-half.browser.ts`, the
 * runtime's own; anywhere else (a server, plain Node) this module, which does none of it and imports
 * nothing a plain Node process cannot.
 *
 * @packageDocumentation
 */
import { OgygiaError } from './messages/server.ts';

/** An island entry's load: the browser's (runtime/entry-locations.ts). The server loads none, as a
 *  snippet boots in the browser only: refused. */
export function import_entry<T>(entry: string, _url?: string): Promise<T> {
	return Promise.reject(
		new OgygiaError('browser_only_on_server', { what: `load island entry ${entry}` })
	);
}

/** The `{@html}` range marks taken out of a root before it hydrates: the browser's
 *  (runtime/html-ranges.ts). The server hydrates nothing: refused. */
export function unmark_html_ranges(_root: Element): void {
	throw new OgygiaError('browser_only_on_server', {
		what: 'take the html range marks out of a root it hydrates'
	});
}
