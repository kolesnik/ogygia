// A Kit-hydrated document (its server's `<meta name="ogygia-csr" content="true">`) under a runtime
// whose build proved there is none (`__OGYGIA_KIT_PAGES__` false, kit-pages-off.test.ts): the
// runtime has no code to share the page with Kit, so it refuses to boot and says `kit_page_unbuilt`.
// The region element stays undefined (the regions keep the server's HTML, Kit hydrates the page) and
// no answer is published, so island code asks the document, whose meta says Kit. (The same document
// under a runtime with Kit pages boots as a mixed page: kit-page-thread.test.ts and the csr suites.)
import { expect, test } from 'vitest';
import { errors_during } from './_logged-errors.ts';

(globalThis as { __OGYGIA_KIT_PAGES__?: boolean }).__OGYGIA_KIT_PAGES__ = false;
const { boot } = await import('../../src/runtime/core.ts');
const { kit_answer } = await import('../../src/wire-markup.ts');
const { documentIsCsrTrue } = await import('../../src/context.ts');

test('a document Kit hydrates is refused at boot, with a code', async () => {
	const meta = document.createElement('meta');
	meta.setAttribute('name', 'ogygia-csr');
	meta.setAttribute('content', 'true');
	document.head.append(meta);
	document.body.innerHTML = '<ogygia-region wake="load" entry="x"><p>server</p></ogygia-region>';
	const errors = await errors_during(async () => boot());
	expect(errors).toHaveLength(1);
	expect(errors[0]).toMatch(/^kit_page_unbuilt /);
	expect(customElements.get('ogygia-region')).toBeUndefined();
	expect(kit_answer()).toBeNull();
	expect(documentIsCsrTrue()).toBe(true);
	expect(document.querySelector('ogygia-region p')?.textContent).toBe('server');
});
