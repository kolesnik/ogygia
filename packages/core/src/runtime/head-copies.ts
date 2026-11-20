/**
 * The head blocks islands write: what an island's hydrate step put in `<head>`, and the page's
 * server copies of it, retired once the island's own are live. Who owns which head node is the
 * session's (./session.ts `RuntimeSession`: `page_head`, `island_head`); this module reads and
 * edits the head, and only the lazy chunks that do that import it (the hydrate core after an
 * island's hydrate step, router-nav after a navigation's head merge), so no boot carries it.
 *
 * @internal
 */
import type { RuntimeSession } from './session.ts';

const STYLESHEET_REL_RE = /(?:^|\s)stylesheet(?:\s|$)/i;

/** The session's record of who owns the head's nodes. */
export type HeadOwners = Pick<RuntimeSession, 'page_head' | 'island_head'>;

// @why Svelte's compiled client template trims the text the server wrote as the source has it (test: test/browser/island-head-order.test.ts › a style written over several lines in an island's head is one copy once the island wakes (#1122))
function head_copy_key(el: Element): string {
	const key = `${el.localName}${Array.from(el.attributes, (a) => `\0${a.name}\0${a.value}`).join('')}`;
	return el.childElementCount === 0
		? `${key}\0\0t${(el.textContent ?? '').trim()}`
		: `${key}\0\0h${el.innerHTML}`;
}

/** What one island's hydrate step put in `<head>` ({@link mark_head}). */
export interface HeadMark {
	/** The head's elements now that were not its children when the mark was made, in head order. */
	added(): Element[];
	/** The same, every node (an island's head block is its elements and Svelte's text anchor). */
	nodes(): Node[];
	/** Stop noting (a step that ended without a record). */
	stop(): void;
}

function added_children(head: Element, records: MutationRecord[]): Node[] {
	const was_child = new Map<Node, boolean>();
	for (const r of records) {
		for (const n of r.removedNodes) if (!was_child.has(n)) was_child.set(n, true);
		for (const n of r.addedNodes) if (!was_child.has(n)) was_child.set(n, false);
	}
	const out: Node[] = [];
	for (const [n, was] of was_child) if (!was && n.parentNode === head) out.push(n);
	if (out.length > 1) out.sort((a, b) => (a.compareDocumentPosition(b) & 4 ? -1 : 1));
	return out;
}

function take_page_slot(nodes: Node[], own: Element[], page_head: WeakSet<Node>): void {
	const head = document.head;
	const first = nodes[0];
	const last = nodes[nodes.length - 1];
	const run = new Set(nodes);
	// @why Svelte removes a head block by walking from its first node to its last (test: test/browser/island-head-order.test.ts › a run another node stands inside stays where it is (Svelte removes a head block from its first node to its last))
	for (let n: Node | null = first; n !== last; n = n.nextSibling)
		if (n === null || !run.has(n)) return;
	const keys = new Set<string>();
	for (const el of own) keys.add(head_copy_key(el));
	for (const el of head.children) {
		if (run.has(el) || !page_head.has(el) || !keys.has(head_copy_key(el))) continue;
		for (const n of nodes) head.insertBefore(n, el);
		return;
	}
}

/**
 * Before an island's hydrate step: start noting what lands in `<head>`. A MutationObserver on the
 * head's own children, read synchronously when the step ends, so the record costs what the island
 * added, not the whole head (a copy of the head per island grew as islands × head). Without
 * MutationObserver: the head's elements, copied.
 */
export function mark_head(): HeadMark {
	const head = document.head;
	let taken: Node[] | null = null;
	let take: () => Node[];
	let stop = (): void => {};
	if (typeof MutationObserver === 'undefined') {
		const before = new Set<Node>(head.childNodes);
		take = () => Array.from(head.childNodes).filter((n) => !before.has(n));
	} else {
		const delivered: MutationRecord[] = [];
		// oxlint-disable-next-line ogygia/owned-effects -- the hydrate step's own: the mark it hands back disconnects it (`added`, `nodes`, `stop`)
		const watch = new MutationObserver((records) => delivered.push(...records));
		watch.observe(head, { childList: true });
		stop = () => watch.disconnect();
		take = () => {
			const records = delivered.concat(watch.takeRecords());
			watch.disconnect();
			return added_children(head, records);
		};
	}
	const nodes = (): Node[] => (taken ??= take());
	return {
		added: () => nodes().filter((n): n is Element => n.nodeType === 1),
		nodes,
		stop
	};
}

/** After an island's hydrate: the head elements it added (not there before the step, not
 *  page-owned) are that island's; they take the place of the page's copy of them, which is
 *  retired. */
export function record_island_head(s: HeadOwners, mark: HeadMark): void {
	const own: Element[] = [];
	for (const n of mark.added()) {
		if (!s.page_head.has(n)) {
			s.island_head.add(n);
			own.push(n);
		}
	}
	if (own.length === 0) return;
	take_page_slot(mark.nodes(), own, s.page_head);
	retire_page_head_copies(s);
}

/**
 * Remove every PAGE-owned head element that duplicates a live island-owned one ({@link head_copy_key}), and
 * the page's `<title>` once an island renders its own (the browser honours the first title, and
 * the island's is the reactive one). Runs after an island hydrates and after a navigation merge.
 */
export function retire_page_head_copies(s: HeadOwners): void {
	const live = new Set<string>();
	let island_title = false;
	for (const el of s.island_head) {
		if (!el.isConnected) {
			s.island_head.delete(el);
			continue;
		}
		live.add(head_copy_key(el));
		if (el.localName === 'title') island_title = true;
	}
	if (live.size === 0) return;
	for (const el of Array.from(document.head.children)) {
		if (!s.page_head.has(el)) continue;
		if (el.localName === 'link' && STYLESHEET_REL_RE.test(el.getAttribute('rel') ?? '')) continue;
		if ((island_title && el.localName === 'title') || live.has(head_copy_key(el))) el.remove();
	}
}
