/**
 * A HOLE'S RENDER notes its early start (./early-holes.ts): only the hole's render imports this, so
 * a server without holes holds none of it (apps/palaestra/e2e/server-size.ts SERVER_PROGRAMS).
 *
 * @packageDocumentation
 */
import { get_request_event } from '#region-server';
import { early_holes } from './context.ts';

/**
 * Note a top-level `defer: 'load'` hole's endpoint for this request: the head starts its request
 * during the parse (early-holes.ts), written once by the handle or `document()`, which take the
 * list. Identical holes share one endpoint, and one request. Client / no-request: nothing to note.
 */
export function note_early_hole(endpoint: string): void {
	try {
		const { request } = get_request_event() as { request: Request };
		let seen = early_holes.get(request);
		if (!seen) early_holes.set(request, (seen = new Set()));
		seen.add(endpoint);
		// oxlint-disable-next-line ogygia/no-silent-failures -- no request (the client, a build step): no head to start it from
	} catch {}
}
