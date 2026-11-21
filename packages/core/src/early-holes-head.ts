/**
 * The head's early start (./early-holes.ts), as tags: written by the handle and `document()`, and
 * read by the tests that run it. Kept apart from ./early-holes.ts so the runtime, which only reads
 * the global, never loads `script()`.
 */
import { get_request_event } from '#region-server';
import { early_holes } from './context.ts';
import { EARLY_HOLES_ID, EARLY_HOLES_KEY, start_early_holes } from './early-holes.ts';
import { script } from './script.ts';

/** This request's noted `load` hole endpoints, taken once (the head that writes them). `request`: the
 *  one the caller holds (the handle's event); else the current render's. */
export function take_early_holes(request?: Request): string[] {
	if (!request)
		try {
			request = (get_request_event() as { request: Request }).request;
			// oxlint-disable-next-line ogygia/no-silent-failures -- no request, so no hole of it was noted
		} catch {
			return [];
		}
	const seen = early_holes.get(request);
	if (!seen) return [];
	early_holes.delete(request);
	return [...seen];
}

/** The early start's script tag, the same bytes on every page (its CSP hash is computed from it). */
export const EARLY_HOLES_TAG: string = script(start_early_holes, EARLY_HOLES_ID, EARLY_HOLES_KEY);

/** The head's early start for `endpoints` (the request's `load` holes, each once): the data block,
 *  then the script that reads it. Nothing for none. */
export function early_holes_head(endpoints: readonly string[]): string {
	if (endpoints.length === 0) return '';
	return script({ json: [...endpoints], id: EARLY_HOLES_ID }) + EARLY_HOLES_TAG;
}
