/**
 * A navigation's release of the region head nodes its head merge left. Only router-nav runs it; what
 * the regions on the page use and own is the boot's (./region-sheets.ts `sheets_in_use`, read
 * through the boot link), so no boot carries this code.
 *
 * @internal
 * @packageDocumentation
 */
import { head_owners } from '../head-owners.ts';
import { OG_OWNER } from '../wire-markup.ts';
import type { SheetsInUse } from './region-sheets.ts';

/**
 * After a navigation's swap: of the region head nodes the new page's head does not list
 * (`unlisted`: region sheets, and every tag that names an owning region), take out each one no
 * region on the page uses or owns any more (`in_use`, read only when there is one to judge). A tag
 * names its owners (`data-og-owner`, the outermost islands' fingerprints, space-separated) because
 * the server skips a region the browser already has, and the tags its inner regions wrote with it
 * (#806). A sheet several outer islands share names them all (#854, head-owners.ts).
 *
 * Every owner list is cut to the owners still on the page (kept to its first when none is): one
 * that left can come back only rendered again, and its tags name it again then.
 */
export function release_head_nodes(unlisted: readonly Element[], in_use: () => SheetsInUse): void {
	const shared = document.head.querySelectorAll(`[${OG_OWNER}*=" "]`);
	if (unlisted.length === 0 && shared.length === 0) return;
	const { used, owners } = in_use();
	for (const node of unlisted) {
		if (used.has(node)) continue;
		if (head_owners(node).some((o) => owners.has(o))) continue;
		node.remove();
	}
	for (const node of Array.from(shared)) {
		if (!node.isConnected) continue;
		const list = head_owners(node);
		const on_page = list.filter((o) => owners.has(o));
		node.setAttribute(OG_OWNER, (on_page.length ? on_page : list.slice(0, 1)).join(' '));
	}
}
