/**
 * Whether Kit hydrates the live document, once per page visit. The probe itself is the page
 * markup's (../wire-markup.ts `KitBoot`), where island code reads it too.
 */
import { runtime_session } from './session.ts';
import { KIT_HYDRATES_KEY, KitBoot, kit_meta_of } from '../wire-markup.ts';
import { OgygiaError } from '../messages/core.ts';

const KIT_PAGES = typeof __OGYGIA_KIT_PAGES__ !== 'undefined' ? __OGYGIA_KIT_PAGES__ : true;
const no_kit = (): boolean => false;

/**
 * Hand island code the answer below ({@link KIT_HYDRATES_KEY}): the runtime does at boot. A build
 * whose routes Kit hydrates none of (no {@link KIT_PAGES}) answers no without probing; on a document
 * whose server says Kit hydrates it all the same, it refuses to boot (`kit_page_unbuilt`) and
 * returns false, publishing nothing, so island code asks the document itself.
 */
export function publish_kit_hydrates(): boolean {
	if (!KIT_PAGES && typeof document !== 'undefined' && kit_meta_of(document)) {
		console.error(new OgygiaError('kit_page_unbuilt'));
		return false;
	}
	(globalThis as unknown as Record<symbol, unknown>)[KIT_HYDRATES_KEY] = KIT_PAGES
		? kit_hydrates_page
		: no_kit;
	return true;
}

/**
 * Mixed mode: on a csr=true page, Kit boots and hydrates the whole tree (including our island
 * components). THE one answer for the live document — read once (the meta, else the probe), cached
 * on the session, cleared when the router prepares the next document. Every caller (the region
 * element's guards, the router's start, the wrapper's client leg through `KIT_HYDRATES_KEY`) reads this
 * cache; none probes the document on its own. Without {@link KIT_PAGES}: no, always (a document that
 * says otherwise never boots, {@link publish_kit_hydrates}).
 */
export function kit_hydrates_page(): boolean {
	if (!KIT_PAGES) return false;
	if (runtime_session.kit_page === undefined) {
		runtime_session.kit_page = typeof document !== 'undefined' && KitBoot.document_has(document);
	}
	return runtime_session.kit_page;
}
