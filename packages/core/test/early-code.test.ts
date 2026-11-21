// THE EARLY START OF THE LOAD WAKE'S CODE (src/early-code.ts), on the server: which document gets
// it, what it carries, and its script under a CSP. Its run in a browser: test/browser/early-code.test.ts
// and palaestra e2e/early-code.spec.ts.
import { createHash } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { getRequestEvent, with_request_store } from '@sveltejs/kit/internal/server';
import { set_request_event_stub } from './_stubs/server.request-event.ts';
import { EARLY_CODE_ID, EARLY_CODE_TAG, early_code_tags } from '../src/early-code.ts';
import {
	EARLY_CODE_SOURCE,
	EARLY_HOLES_SOURCE,
	with_early_holes_csp
} from '../src/server/early-holes-csp.ts';
import { DocumentTail, document_tail } from '../src/server/document-tail.ts';
import { marks_critical } from '../src/server/html-scan.ts';

const { handle } = await import('../src/hooks.ts');
const { record_page } = await import('../src/page-seed-registry.ts');

const SCRIPT_BODY_G = /<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g;
const DATA_RE = /<script type="application\/json" id="ogygia-early-code">([^<]*)<\/script>/;
const files_of = (html: string): string[] | null => {
	const m = DATA_RE.exec(html);
	return m ? (JSON.parse(m[1]!) as string[]) : null;
};

describe('the early start script', () => {
	it('is the same bytes on every page, and its hash is of exactly those bytes', () => {
		for (const files of [['/a.js'], ['/core.js', '/b.js', '/c.js']]) {
			const tags = [...early_code_tags(files).matchAll(SCRIPT_BODY_G)];
			expect(tags).toHaveLength(2);
			expect(tags[1]![0]).toBe(EARLY_CODE_TAG);
			const digest = createHash('sha256').update(tags[1]![1]!, 'utf8').digest('base64');
			expect(EARLY_CODE_SOURCE).toBe(`'sha256-${digest}'`);
		}
	});

	it('its data block is JSON (no policy needs a hash for it), and none at all for no file', () => {
		expect(early_code_tags(['/x.js'])).toMatch(
			new RegExp(`^<script type="application/json" id="${EARLY_CODE_ID}">\\["/x\\.js"\\]</script>`)
		);
		expect(early_code_tags([])).toBe('');
	});

	it('a policy that would block it gets its hash beside a nonce, as the early holes script does', () => {
		expect(with_early_holes_csp("script-src 'nonce-abc'", [EARLY_CODE_SOURCE])).toBe(
			`script-src 'nonce-abc' ${EARLY_CODE_SOURCE}`
		);
		expect(EARLY_CODE_SOURCE).not.toBe(EARLY_HOLES_SOURCE);
	});
});

describe('a page that marks a critical resource gets no early start', () => {
	it.each([
		['<img src="/hero.jpg" fetchpriority="high">', true],
		["<IMG SRC=/hero.jpg FETCHPRIORITY='HIGH'>", true],
		['<link rel="preload" as="image" href="/h.jpg" fetchpriority=high>', true],
		['<img src="/h.jpg" fetchpriority = "high">', true],
		['<img src="/logo.png" fetchpriority="low"><img src="/a.png">', false],
		['<p>no marks</p>', false]
	])('%s → %s', (html, marked) => {
		expect(marks_critical(html)).toBe(marked);
	});

	it('only a mark before `end` counts (what the tail is written after)', () => {
		const html = '<p>body</p></body><img fetchpriority="high">';
		expect(marks_critical(html, html.indexOf('</body>'))).toBe(false);
		expect(marks_critical(html)).toBe(true);
	});
});

describe('the tail carries the load wake’s files', () => {
	it('the first wake’s files lead, then each island’s file and chunks, each once', () => {
		const tail = new DocumentTail();
		let reads = 0;
		const wake = () => (reads++, ['/core.js', '/svelte.js']);
		tail.load_island('/a.HASH.js', ['/svelte.js', '/a-dep.js'], wake);
		tail.load_island('/b.HASH.js', ['/a-dep.js'], wake);
		expect(reads).toBe(1);
		expect(tail.wakes_at_load).toBe(true);
		expect(files_of(tail.render(null, false, '', true))).toEqual([
			'/core.js',
			'/svelte.js',
			'/a.HASH.js',
			'/a-dep.js',
			'/b.HASH.js'
		]);
	});

	it('written first in the tail, and only when the document allowed it', () => {
		const tail = new DocumentTail();
		tail.graph('/a.js', ['/svelte.js']);
		tail.load_island('/a.HASH.js', ['/svelte.js'], () => []);
		const html = tail.render(null, false, '', true);
		expect(html.indexOf(EARLY_CODE_ID)).toBeLessThan(html.indexOf('data-ogygia-graph'));
		expect(files_of(tail.render())).toBe(null);
	});

	it('an island that wakes at load with no chunk of its own still fills the tail (its file)', () => {
		const tail = new DocumentTail();
		tail.load_island('/a.HASH.js', [], () => []);
		expect(tail.empty).toBe(false);
		expect(files_of(tail.render(null, false, '', true))).toEqual(['/a.HASH.js']);
	});

	it('a page with no island that wakes at load carries none', () => {
		const tail = new DocumentTail();
		tail.graph('/a.js', ['/svelte.js']);
		expect(tail.wakes_at_load).toBe(false);
		expect(files_of(tail.render(null, false, '', true))).toBe(null);
	});
});

const event_for = (u: URL) =>
	({
		url: u,
		request: new Request(u),
		getClientAddress: () => '203.0.113.7',
		cookies: { get: () => undefined },
		route: { id: null },
		params: {},
		isDataRequest: false,
		setHeaders() {},
		platform: undefined,
		locals: {}
	}) as never as { request: Request; url: URL };

afterEach(() => set_request_event_stub(null));

/** A csr=false page through the handle as Kit 2 runs it, its HTML handed over in `chunks` (one for a
 *  page rendered whole). `render` runs as the page's render does; `policy` is the page's CSP. */
async function page(
	chunks: string[],
	render: (tail: DocumentTail) => void,
	policy = "script-src 'self'"
): Promise<{ html: string; csp: string }> {
	set_request_event_stub(() => getRequestEvent());
	const event = event_for(new URL('https://app.test/p'));
	let html = '';
	let response!: Response;
	await with_request_store({ event, state: {} } as never, async () => {
		response = await handle()({
			event: event as never,
			resolve: (ev, opts) =>
				with_request_store(null, async () => {
					with_request_store({ event: { ...ev }, state: {} } as never, () => {
						record_page({ data: {} }, false);
						render(document_tail()!);
					});
					for (const [i, chunk] of chunks.entries())
						html +=
							(await opts!.transformPageChunk!({ html: chunk, done: i === chunks.length - 1 })) ??
							'';
					return new Response(html, {
						headers: { 'content-type': 'text/html', 'content-security-policy': policy }
					});
				})
		});
	});
	return { html, csp: response.headers.get('content-security-policy') ?? '' };
}

const HEAD = '<!doctype html><html><head><title>t</title></head>';
const BODY = '<body><p>page</p></body></html>';
const load_island = (tail: DocumentTail) =>
	tail.load_island('/_app/a.HASH.js', ['/_app/dep.js'], () => ['/_app/core.js']);

describe('the handle writes the early start where nothing can be hurt by it', () => {
	it('a csr=false page whose island wakes at load: the files, the script, its hash in the policy', async () => {
		const { html, csp } = await page([HEAD + BODY], load_island);
		expect(files_of(html)).toEqual(['/_app/core.js', '/_app/a.HASH.js', '/_app/dep.js']);
		expect(html).toContain(EARLY_CODE_TAG);
		expect(html.indexOf(EARLY_CODE_TAG)).toBeLessThan(html.indexOf('</body>'));
		expect(csp).toBe(`script-src 'self' ${EARLY_CODE_SOURCE}`);
	});

	it('a page whose markup marks a critical resource: no early start, the policy untouched', async () => {
		const hero = BODY.replace(
			'<p>page</p>',
			'<img src="/hero.jpg" fetchpriority="high"><p>page</p>'
		);
		const { html, csp } = await page([HEAD + hero], load_island);
		expect(files_of(html)).toBe(null);
		expect(html).not.toContain(EARLY_CODE_TAG);
		expect(csp).toBe("script-src 'self'");
	});

	it('a page with no island that wakes at load: none', async () => {
		const { html, csp } = await page([HEAD + BODY], () => {});
		expect(files_of(html)).toBe(null);
		expect(csp).toBe("script-src 'self'");
	});

	it('a head sent before its body (a streamed page): none, since the head never allowed it', async () => {
		const { html, csp } = await page([HEAD, BODY], load_island);
		expect(files_of(html)).toBe(null);
		expect(csp).toBe("script-src 'self'");
	});

	it('a Kit-hydrated page: none', async () => {
		const kit = BODY.replace(
			'</body>',
			'<script>{ __sveltekit_abc = { base: "" }; Promise.all([]).then(() => {}); }</script></body>'
		);
		const { html, csp } = await page([HEAD + kit], load_island);
		expect(files_of(html)).toBe(null);
		expect(csp).toBe("script-src 'self'");
	});
});
