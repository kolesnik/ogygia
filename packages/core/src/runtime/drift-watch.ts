import * as life from '@ogygia/machine/internal';
import type { Life } from '@ogygia/machine/internal';
import { walk_enters } from './ownership.ts';

const REGION = 'ogygia-region';
const supported = typeof MutationObserver !== 'undefined';
const WATCHED: MutationObserverInit = { childList: true, characterData: true, subtree: true };

/**
 * The sleeping regions and the one observer over them. A wake does not re-observe the others: the
 * region that woke stays observed (its records are ignored, as nothing still asleep holds them) until
 * the regions that woke since the last rebuild are as many as those asleep, so the observe calls of a
 * page's whole boot stay within twice its regions. The pending records are taken at every change of
 * who sleeps, so each record is judged against the regions asleep when it was made.
 */
class SleepWatch {
	readonly changed = new WeakSet<Element>();
	/** Each sleeping region, with how many sleeps hold it. */
	readonly #asleep = new Map<Element, number>();
	/** Regions that woke since the last rebuild, still observed (at most: one that slept again counts too). */
	#woken = 0;
	#observer: MutationObserver | null = null;

	watch(sleep: Life, region: Element): void {
		if (this.#woken) this.take();
		this.#asleep.set(region, (this.#asleep.get(region) ?? 0) + 1);
		sleep.defer(() => this.#woke(region));
		// oxlint-disable-next-line ogygia/owned-effects -- one observer for every sleeping region: each region's sleep owns its place in it, and the rebuild after the wakes observes only the regions left
		(this.#observer ??= new MutationObserver((records) => this.note(records))).observe(
			region,
			WATCHED
		);
	}

	/** Pending records, judged now. */
	take(): void {
		if (this.#observer) this.note(this.#observer.takeRecords());
	}

	note(records: MutationRecord[]): void {
		const judged = this.#woken !== 0;
		for (const r of records) {
			// the outermost region around the change (no element above it can hide one), and whether a
			// region still asleep holds the change (one that woke since the last rebuild is observed still)
			let top: Element | null = null;
			let held = !judged;
			for (let n: Node | null = r.target; n; n = n.parentNode) {
				if (n.nodeType !== 1) continue;
				if ((n as Element).localName === REGION) top = n as Element;
				if (!held && this.#asleep.has(n as Element)) held = true;
			}
			if (top === null || !held) continue;
			for (let n: Node | null = r.target; n; n = n.parentNode) {
				if (n.nodeType !== 1) continue;
				const el = n as Element;
				if (el.localName === REGION) this.changed.add(el);
				if (el === top || !walk_enters(el)) break;
			}
		}
	}

	#woke(region: Element): void {
		this.take();
		const left = this.#asleep.get(region)! - 1;
		if (left) this.#asleep.set(region, left);
		else this.#asleep.delete(region);
		if (++this.#woken < this.#asleep.size) return;
		this.#woken = 0;
		this.#observer!.disconnect();
		for (const asleep of this.#asleep.keys()) this.#observer!.observe(asleep, WATCHED);
	}
}

const watcher = new SleepWatch();

/**
 * `region` kept its server copy: watch it while `sleep` is open (until it wakes, or leaves the page).
 * One `MutationObserver` over the sleeping regions' own subtrees marks a region changed when a node
 * or a text in it changes (attributes do not count, as the wake's comparison ignores them), and every
 * region around it too, up to an element whose inside Svelte's walk never reads (`walk_enters`: a web
 * component reworking its own light DOM there is not the island drifting). The wake compares, and
 * repairs, only a changed region (`region_changed`).
 */
export function watch_region(sleep: Life, region: Element): void {
	if (!supported || sleep.closed) return;
	watcher.watch(sleep, region);
}

/** The region's copy is stale (it left the document while it slept): compare it at the wake. */
export function mark_region_changed(region: Element): void {
	watcher.changed.add(region);
}

/** Was anything in this region's markup touched since it kept its copy? Read at the wake, BEFORE the
 *  runtime itself edits the island (lakes lifted): the pending records are taken first, so nothing is
 *  decided by timing. In a browser without MutationObserver, always true: every region compares. */
export function region_changed(region: Element): boolean {
	if (!supported) return true;
	watcher.take();
	return watcher.changed.has(region);
}
