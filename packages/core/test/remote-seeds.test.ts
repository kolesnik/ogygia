// The remote-seeds feature (src/runtime/remote-seeds.ts): the page's `application/ogygia-remote`
// script seeds the Kit client query cache once per document, and again only after a navigation
// replaced the page.
import { beforeEach, afterEach, expect, test, vi } from 'vitest';

const seeded = vi.hoisted(() => [] as string[]);
vi.mock('../src/shims/kit-remote/client-stub.ts', () => ({
	seed_query_responses: (text: string) => seeded.push(text)
}));

const { seed_once } = await import('../src/runtime/remote-seeds.ts');
const { init } = await import('../src/runtime/lazy-link.ts');
const { RuntimeSession } = await import('../src/runtime/session.ts');
const { server_channel } = await import('../src/runtime/response-mark.ts');
const { L_RUNTIME_SESSION, L_SERVER_CHANNEL } = await import('../src/runtime/boot-link-index.ts');
type BootLink = import('../src/runtime/boot-link.ts').BootLink;

/** A script the server wrote: it bears the document's response mark. */
const server_script = (text: string) => ({ textContent: text, getAttribute: () => 'mark' });

let script: ReturnType<typeof server_script> | null = null;
const session = new RuntimeSession();

beforeEach(() => {
	seeded.length = 0;
	script = server_script('{"q":1}');
	vi.stubGlobal('document', {
		head: { querySelector: () => ({ getAttribute: () => 'mark' }) },
		querySelectorAll: (sel: string) =>
			sel === 'script[type="application/ogygia-remote"]' && script ? [script] : []
	});
	// (the boot's link, as the boot hands it to the hydrate core: the session and the channel reader)
	const link: unknown[] = [];
	link[L_RUNTIME_SESSION] = session;
	link[L_SERVER_CHANNEL] = server_channel;
	init(link as unknown as BootLink);
	session.reset();
});
afterEach(() => {
	vi.unstubAllGlobals();
});

test('the page’s remote script seeds the query cache once per document', () => {
	seed_once();
	seed_once();
	seed_once();
	expect(seeded).toEqual(['{"q":1}']);
});

test('after a navigation replaced the page, the new page’s script seeds again', () => {
	seed_once();
	session.reset();
	script = server_script('{"q":2}');
	seed_once();
	expect(seeded).toEqual(['{"q":1}', '{"q":2}']);
});

test('a page without the script seeds nothing, and is done', () => {
	script = null;
	seed_once();
	script = server_script('{"late":1}');
	seed_once();
	expect(seeded).toEqual([]);
});
