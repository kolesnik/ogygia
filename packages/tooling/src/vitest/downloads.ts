/**
 * The downloads a browser test's page makes, for the tests that check what was asked for. A page's
 * resource timeline (`performance.getEntriesByType('resource')`) keeps 250 entries and drops each
 * one after; a dev run loads one module per source file, so a test file's frame often fills it
 * before its first test starts. Read from there, a download past the 250th is never seen: a wait
 * for it times out, and a check that a file was never asked passes without looking. A resource
 * `PerformanceObserver` hears every entry, the timeline full or not: this is one.
 *
 * Made once per test file, at the top: it hears what the timeline still holds, then every download
 * after, for as long as the file's frame lives.
 *
 * @packageDocumentation
 */
import { expect, onTestFinished } from 'vitest';

/** The size a browser gives a page's resource timeline. */
const TIMELINE_SIZE = 250;

/** The running test starts with its page's resource timeline full, as a dev run's frame often does,
 *  until it ends: a download it checks is then heard by a {@link Downloads} or not at all. */
export function timeline_full(): void {
	performance.setResourceTimingBufferSize(performance.getEntriesByType('resource').length);
	onTestFinished(() => performance.setResourceTimingBufferSize(TIMELINE_SIZE));
}

export class Downloads {
	#heard: PerformanceResourceTiming[] = [];
	// oxlint-disable-next-line ogygia/owned-effects -- the test file's frame owns it: it hears every download for as long as the file runs, and goes with the frame
	#observer = new PerformanceObserver((list) => this.#hear(list.getEntries()));

	constructor() {
		this.#observer.observe({ type: 'resource', buffered: true });
	}

	/** Each download heard so far whose URL holds `part`, oldest first. */
	named(part: string): PerformanceResourceTiming[] {
		this.#hear(this.#observer.takeRecords());
		return this.#heard.filter((e) => e.name.includes(part));
	}

	/** Resolves once a download whose URL holds `part` is heard: its file is on its way. */
	async loading(part: string, timeout = 5_000): Promise<void> {
		await expect
			.poll(() => this.named(part).length > 0, {
				timeout,
				message: `a download whose URL holds ${part}`
			})
			.toBe(true);
	}

	/** Forgets every download heard so far: later reads see only the ones after this. */
	forget(): void {
		this.#observer.takeRecords();
		this.#heard = [];
	}

	#hear(entries: PerformanceEntryList): void {
		for (const e of entries) this.#heard.push(e as PerformanceResourceTiming);
	}
}
