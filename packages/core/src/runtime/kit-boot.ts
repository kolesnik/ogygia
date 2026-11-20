/**
 * Whether Kit hydrates the live document, once per page visit. The probe itself is the page
 * markup's (../wire-markup.ts `KitBoot`), where island code reads it too.
 */
import { runtime_session } from './session.ts';
import { KitBoot } from '../wire-markup.ts';

/**
 * Mixed mode: on a csr=true page, Kit boots and hydrates the whole tree (including our island
 * components). THE one answer for the live document — read once (the meta, else the probe), cached
 * on the session, cleared when the router prepares the next document. Every caller (the region
 * element's guards, the router's start, the wrapper's client leg through `KIT_HYDRATES_KEY`) reads this
 * cache; none probes the document on its own.
 */
export function kit_hydrates_page(): boolean {
	if (runtime_session.kit_page === undefined) {
		runtime_session.kit_page = typeof document !== 'undefined' && KitBoot.document_has(document);
	}
	return runtime_session.kit_page;
}
