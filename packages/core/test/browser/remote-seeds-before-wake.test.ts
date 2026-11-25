// A navigation (and a soft refresh) brings the next page's remote seed into the query cache even
// when no island woke on the page it leaves: the hydrate core never loaded there, and the page
// feature reads the remote-seeds feature itself (`ogygia:boot/remote-seeds`). Otherwise the
// navigation marks the next document seeded with its seed dropped, and its islands query again.
import { afterEach, expect, test } from 'vitest';
import { stringify } from 'devalue';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { init } from '../../src/runtime/lazy-link.ts';
import { apply_soft_invalidate_doc, prepare_spa_document } from '../../src/runtime/seeds.ts';
import { query_responses } from '../../src/shims/kit-remote/client-stub.ts';

// (the navigation chunk, as the boot hands it its link: no island woke, so no hydrate core)
init(link_boot());

/** The attribute the handle writes the response's mark in (contract/response-mark.ts). */
const MARK_ATTR = 'data-og-mark';
const MARK = '0123456789abcdef01234567';

/** The next page as a navigation fetched it: its head runtime script and its remote seed, both
 *  bearing the response's mark. */
function next_page(seed: Record<string, unknown>): Document {
	const doc = document.implementation.createHTMLDocument('next');
	const runtime = doc.createElement('script');
	runtime.setAttribute('data-ogygia-runtime', '');
	runtime.setAttribute(MARK_ATTR, MARK);
	runtime.type = 'application/x-runtime-stand-in';
	doc.head.prepend(runtime);
	const remote = doc.createElement('script');
	remote.type = 'application/ogygia-remote';
	remote.setAttribute(MARK_ATTR, MARK);
	remote.textContent = stringify(seed);
	doc.body.append(remote);
	return doc;
}

afterEach(() => {
	for (const k in query_responses) delete query_responses[k];
});

test('a navigation before any island woke seeds the next page’s remote queries', () => {
	prepare_spa_document();
	apply_soft_invalidate_doc(next_page({ q: { 'q/key': 'next page' } }));
	expect(query_responses['q/key']).toBe('next page');
});
