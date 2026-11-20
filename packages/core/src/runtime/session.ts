import * as life from '@ogygia/machine/internal';
import type { Life } from '@ogygia/machine/internal';
import { note_visit } from './rules.ts';

/**
 * THE PAGE VISIT: one per page the visitor is on, the document load, then each page a navigation
 * swaps in. It ends when the next page's swap takes over (`RuntimeSession.reset`). What the page
 * holds is its own and goes with it: on `scope`, its listeners, timers, observers and streams (the
 * router's link scan, the batch of its holes, the waits for the sheets its answers bring); in
 * `facts`, what its answers brought for its next hydrate.
 *
 * A navigation makes the visit of the page it brings before its swap (`RuntimeSession.next_visit`):
 * what it starts for that page early, the batch of its holes, is that visit's. A navigation that
 * ends without its swap (called off, taken over, given to the browser) ends that visit, never the
 * page's (./router-nav.ts `navigate`).
 */
export type PageVisit = {
	/** Closed when the visit ends. */
	readonly scope: Life;
	/** The page facts answers rendered with (server/render-page.ts), queued at the answer seam
	 *  (`region_fragment`) for the next hydrate to merge into the page store (seeds.ts). This page's
	 *  only: the next page's visit starts with none (#269). */
	readonly facts: string[];
	/** Its seeds are in the stores (seeds.ts, remote-seeds.ts): read once per page. */
	readonly seeded: { page: boolean; remote: boolean };
	/** Kit hydrates this page (kit-boot.ts): asked once, on first need. */
	kit_page: boolean | undefined;
};

function page_visit(): PageVisit {
	const visit: PageVisit = {
		scope: life.root(),
		facts: [],
		seeded: { page: false, remote: false },
		kit_page: undefined
	};
	note_visit(visit, false);
	return visit;
}

export class RuntimeSession {
	/** Page-owned head nodes: a navigation replaces these, and only these. Survives `reset()`: it is the document's, not a page's. */
	readonly page_head: WeakSet<Node> = new WeakSet<Node>();
	/** Island-owned head ELEMENTS still to watch (pruned when they leave the document). */
	readonly island_head: Set<Element> = new Set<Element>();

	/** Mark a node this document's page owns (the router / runtime inserted it for the page). */
	claim_page_head(node: Node): void {
		this.page_head.add(node);
	}

	/** At boot: everything already in <head> came from the server — the page owns it. */
	adopt_document_head(): void {
		if (typeof document === 'undefined') return;
		for (const n of document.head.children) this.page_head.add(n);
	}

	#visit: PageVisit = page_visit();
	/** The visit of the page on screen (see {@link PageVisit}). */
	get visit(): PageVisit {
		return this.#visit;
	}

	/** The visit of the page a navigation brings, made before its swap: the navigation's (it ends
	 *  it when there is no swap) until `reset(next)` makes it the page. */
	next_visit(): PageVisit {
		return page_visit();
	}

	get remote_seeded(): boolean {
		return this.#visit.seeded.remote;
	}
	mark_remote_seeded(): void {
		this.#visit.seeded.remote = true;
	}

	get page_seeded(): boolean {
		return this.#visit.seeded.page;
	}
	mark_page_seeded(): void {
		this.#visit.seeded.page = true;
	}

	get kit_page(): boolean | undefined {
		return this.#visit.kit_page;
	}
	set kit_page(v: boolean | undefined) {
		this.#visit.kit_page = v;
	}

	/** The next page takes over (its visit, made by its navigation; a new one when none is given),
	 *  and the visit of the page it replaces ends. */
	reset(next: PageVisit = page_visit()): void {
		const left = this.#visit;
		this.#visit = next;
		note_visit(next, true);
		if (left !== next) left.scope.close();
	}
}

/** Process-wide session for the islands runtime (one client module graph). */
export const runtime_session: RuntimeSession = new RuntimeSession();
