/**
 * THE EARLY START OF THE LOAD WAKE'S CODE. A csr=false document's runtime is a module script: it
 * runs once the whole HTML is in, and only then do the islands that wake at load ask for their code
 * (the hydrate core, each island's file and its chunks). On a long document on a slow link that is
 * a second or more after the code could have started. So the document's tail opens with one data
 * block (the files the load wake is sure to import, JSON: no CSP allowance needed) and one inline
 * script that is the same bytes on every page ({@link EARLY_CODE_TAG}): once the page has painted
 * its first content, it adds a low-priority `modulepreload` per file, so the code downloads beside
 * the rest of the HTML instead of after it.
 *
 * Only where nothing could be hurt by it. A page with a deferred hole gets none: the early code
 * shares the link with the rest of the HTML, so the parse ends later, and a hole's content (visible
 * content the runtime inserts after the parse) would come later with it. A page that marks a
 * critical resource (`fetchpriority="high"`: the LCP hero the load scheduler's gate waits for,
 * ./runtime/load-scheduler.ts) gets none either: the server leaves the block out when the
 * document's markup marks one (./server/html-scan.ts `marks_critical`), so such a page pays no byte
 * for it, and the script stands down when the document holds one when it runs (one the markup scan
 * could not see). Then the runtime's own gate decides, as before.
 *
 * It stands in for the runtime only until the runtime is up: when first paint comes after the
 * runtime defined `<ogygia-region>`, the runtime's own wake owns the downloads, and the script adds
 * nothing. The links it adds carry the island graph's mark, so the wake that imports a file joins
 * its fetch and raises its priority (./runtime/island-graph-preload.ts).
 *
 * The script never changes, so its hash is a constant: a policy that would block it gets that hash
 * (./server/early-holes-csp.ts `EARLY_CODE_SOURCE`). Universal.
 *
 * @packageDocumentation
 */
import { close_safe } from './script.ts';
import { OGYGIA_GRAPH_PRELOAD } from './wire-markup.ts';
import { escape_script_text } from './escape.ts';

/** The id of the tail's data block: the files the load wake imports, as rendered. */
export const EARLY_CODE_ID = 'ogygia-early-code';

/** The `data-ogygia-graph-preload` value of a link the early start added. */
export const EARLY_CODE_MARK = 'early';

/** Early downloads in flight at once: what the parse leaves idle, never a queue the runtime's own
 *  first requests would wait behind. */
export const EARLY_CODE_WINDOW = 4;

/** The early start, run inline at the head of the document's tail (self-contained: browser globals
 *  only, its source inlined by `toString`). */
export function start_early_code(id: string, width: number, attr: string, mark: string): void {
	const data = document.getElementById(id);
	const types =
		typeof PerformanceObserver === 'function' && PerformanceObserver.supportedEntryTypes;
	if (!data || !types || !types.includes('paint') || document.visibilityState === 'hidden') return;
	// oxlint-disable-next-line ogygia/owned-effects -- an inline script's one paint observer (no imports, so no scope): its first paint disconnects it
	const observer = new PerformanceObserver((list) => {
		if (!list.getEntriesByName('first-contentful-paint').length) return;
		observer.disconnect();
		if (document.querySelector('[fetchpriority="high" i]')) return;
		const linked = new Set<string>();
		for (const l of document.querySelectorAll<HTMLLinkElement>('link[rel="modulepreload"]'))
			linked.add(l.href);
		const files: string[] = [];
		for (const href of JSON.parse(data.textContent || '[]') as string[]) {
			const url = new URL(href, document.baseURI).href;
			if (linked.has(url)) continue;
			linked.add(url);
			files.push(url);
		}
		let next = 0;
		const start = (): void => {
			if (next >= files.length || customElements.get('ogygia-region')) return;
			const link = document.createElement('link');
			link.rel = 'modulepreload';
			link.setAttribute('fetchpriority', 'low');
			link.setAttribute(attr, mark);
			link.href = files[next++]!;
			// oxlint-disable-next-line ogygia/owned-effects -- once, on a link of the script's own: its download's end is its end
			link.addEventListener('load', start, { once: true });
			// oxlint-disable-next-line ogygia/owned-effects -- once, on a link of the script's own: its download's end is its end
			link.addEventListener('error', start, { once: true });
			document.head.appendChild(link);
		};
		for (let i = 0; i < width; i++) start();
	});
	observer.observe({ type: 'paint', buffered: true });
}

/** The early start's script tag, the same bytes on every page (its CSP hash is computed from it). */
export const EARLY_CODE_TAG: string = `<script>(${close_safe(String(start_early_code))})(${[
	EARLY_CODE_ID,
	EARLY_CODE_WINDOW,
	OGYGIA_GRAPH_PRELOAD,
	EARLY_CODE_MARK
]
	.map((arg) => escape_script_text(JSON.stringify(arg)))
	.join(',')});</script>`;

/** The tail's early start for `hrefs` (the load wake's files, each once): the data block, then the
 *  script that reads it. Nothing for none. */
export function early_code_tags(hrefs: readonly string[]): string {
	if (hrefs.length === 0) return '';
	return `<script type="application/json" id="${EARLY_CODE_ID}">${escape_script_text(JSON.stringify(hrefs))}</script>${EARLY_CODE_TAG}`;
}
