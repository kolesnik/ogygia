/**
 * The downloads an e2e page makes, for the specs that check what was asked for and when. A page's
 * resource timeline (`performance.getEntriesByType('resource')`) keeps 250 entries and drops each
 * one after; a dev server loads one module per source file, so a page often fills it before its
 * islands wake. Read from there inside `page.evaluate`, a download past the 250th is never seen: a
 * check that a file came late, or came twice, passes without looking. A resource
 * `PerformanceObserver` made before the page's first byte hears every one: {@link hear_downloads}
 * makes one in every document the page loads after it is called.
 *
 * Read inside `page.evaluate` with `window.__og_downloads()`, or from the spec with
 * {@link downloads}. The vitest twin is `@ogygia/tooling/vitest/downloads`.
 *
 * @packageDocumentation
 */
import type { Page } from '@playwright/test';

declare global {
	interface Window {
		/** Every download the document made, oldest first ({@link hear_downloads}). */
		__og_downloads?: () => PerformanceResourceTiming[];
	}
}

/** From the page's next document on, every download it makes is heard (the timeline full or not):
 *  call before `page.goto`. */
export async function hear_downloads(page: Page): Promise<void> {
	await page.addInitScript(() => {
		const heard: PerformanceResourceTiming[] = [];
		const hear = (list: PerformanceEntryList) => {
			for (const e of list) heard.push(e as PerformanceResourceTiming);
		};
		// oxlint-disable-next-line ogygia/owned-effects -- the document owns it: it hears every download for as long as the document lives, and goes with it
		const observer = new PerformanceObserver((list) => hear(list.getEntries()));
		observer.observe({ type: 'resource', buffered: true });
		window.__og_downloads = () => {
			hear(observer.takeRecords());
			return heard;
		};
	});
}

/** One download as a spec reads it: its URL and its times on the page's clock. */
export type Download = { name: string; start: number; end: number; initiator: string };

/** Every download the page's document made so far ({@link hear_downloads} first: without it, this
 *  throws rather than read nothing). */
export async function downloads(page: Page): Promise<Download[]> {
	return page.evaluate(() => {
		if (!window.__og_downloads) throw new Error('hear_downloads(page) was not called before goto');
		return window.__og_downloads().map((e) => ({
			name: e.name,
			start: e.startTime,
			end: e.responseEnd,
			initiator: e.initiatorType
		}));
	});
}
