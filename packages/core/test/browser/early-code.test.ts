// THE EARLY START OF THE LOAD WAKE'S CODE (src/early-code.ts), run as the page runs it: its constant
// script, inline, reading its data block. After the first contentful paint it adds a low-priority
// modulepreload per file, at most EARLY_CODE_WINDOW in flight, the next as one ends, never for a
// file already linked; and nothing at all on a page that marks a critical resource or once the
// runtime is up (its own wake owns the downloads then). The server's half: test/early-code.test.ts.
import { afterEach, expect } from 'vitest';
import { commands } from 'vitest/browser';
import { it_with_network_routes } from './_browsers.ts';
import { EARLY_CODE_TAG, EARLY_CODE_WINDOW, early_code_tags } from '../../src/early-code.ts';

declare module 'vitest/browser' {
	interface BrowserCommands {
		hold_downloads(path: string): Promise<void>;
		keep_downloads(path: string): Promise<void>;
	}
}

const EARLY = 'link[rel="modulepreload"][data-ogygia-graph-preload="early"]';
const PAINT =
	typeof PerformanceObserver !== 'undefined' &&
	!!PerformanceObserver.supportedEntryTypes?.includes('paint');

/** The page has painted contentful text (what the script waits for), where the engine reports it. */
async function painted(): Promise<void> {
	const p = document.createElement('p');
	p.textContent = 'content';
	document.body.append(p);
	if (!PAINT) return;
	await expect
		.poll(() => performance.getEntriesByName('first-contentful-paint').length, { timeout: 5_000 })
		.toBeGreaterThan(0);
}

/** The tail's early start for `files`, as the server writes it, run where it stands. */
function run_early_start(files: string[]): void {
	const holder = document.createElement('div');
	holder.innerHTML = early_code_tags(files);
	const data = holder.querySelector('script[type="application/json"]')!;
	document.body.append(data);
	const run = document.createElement('script');
	run.textContent = EARLY_CODE_TAG.slice('<script>'.length, -'</script>'.length);
	document.body.append(run);
}

const settle = () => new Promise((r) => setTimeout(r, 300));
const early_links = () => [...document.querySelectorAll<HTMLLinkElement>(EARLY)];

afterEach(() => {
	document.getElementById('ogygia-early-code')?.remove();
	for (const l of early_links()) l.remove();
});

it_with_network_routes(
	'after first paint: a low-priority modulepreload per file, a few at a time, none for a file already linked',
	async () => {
		const files = Array.from({ length: EARLY_CODE_WINDOW + 2 }, (_, i) => `/early-w-${i}.js`);
		for (const f of files) await commands.hold_downloads(f);
		const linked = document.createElement('link');
		linked.rel = 'modulepreload';
		linked.href = '/early-w-linked.js';
		document.head.append(linked);
		try {
			await painted();
			run_early_start(['/early-w-linked.js', ...files]);
			if (!PAINT) {
				await settle();
				expect(early_links()).toHaveLength(0);
				return;
			}
			await expect.poll(() => early_links().length).toBe(EARLY_CODE_WINDOW);
			await settle();
			expect(early_links()).toHaveLength(EARLY_CODE_WINDOW);
			for (const l of early_links()) {
				expect(l.getAttribute('fetchpriority')).toBe('low');
				expect(l.parentNode).toBe(document.head);
			}
			expect(early_links().map((l) => new URL(l.href).pathname)).toEqual(
				files.slice(0, EARLY_CODE_WINDOW)
			);
			await commands.keep_downloads(files[0]!);
			await expect.poll(() => early_links().length).toBe(EARLY_CODE_WINDOW + 1);
			for (const f of files) await commands.keep_downloads(f);
			await expect.poll(() => early_links().length).toBe(files.length);
			await settle();
			expect(early_links().map((l) => new URL(l.href).pathname)).toEqual(files);
		} finally {
			for (const f of files) await commands.keep_downloads(f);
			linked.remove();
		}
	}
);

it_with_network_routes(
	'a page that holds a critical resource (fetchpriority="high"): nothing',
	async () => {
		const hero = document.createElement('img');
		hero.setAttribute('fetchpriority', 'HIGH');
		document.body.append(hero);
		try {
			await painted();
			run_early_start(['/early-c-0.js']);
			await settle();
			expect(early_links()).toHaveLength(0);
		} finally {
			hero.remove();
		}
	}
);

it_with_network_routes(
	'once the runtime is up (its own wake owns the downloads): no more early links',
	async () => {
		const files = Array.from({ length: EARLY_CODE_WINDOW + 2 }, (_, i) => `/early-r-${i}.js`);
		for (const f of files) await commands.hold_downloads(f);
		try {
			await painted();
			run_early_start(files);
			if (PAINT) await expect.poll(() => early_links().length).toBe(EARLY_CODE_WINDOW);
			customElements.define('ogygia-region', class extends HTMLElement {});
			for (const f of files) await commands.keep_downloads(f);
			await settle();
			expect(early_links()).toHaveLength(PAINT ? EARLY_CODE_WINDOW : 0);
		} finally {
			for (const f of files) await commands.keep_downloads(f);
		}
	}
);
