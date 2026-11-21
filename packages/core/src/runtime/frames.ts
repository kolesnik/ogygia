import type { Life } from '@ogygia/machine';
import { peek } from './frame-store.ts';
import { watch_frames } from './rules.ts';
import { send_batches } from './frame-nav.ts';
import { adopt_early_holes } from './early-holes.ts';
import { runtime_session } from './session.ts';

export { subscribe, peek, ticket, ensure, renew, renewal } from './frame-store.ts';
export { batch_times, join_batch } from './frame-nav.ts';

/** Feature entry: the frame store's watch and the early holes. The boot calls the store directly
 *  (`ogygia:boot/feature-code`), and hands the lazy chunks its parts on its link (./boot-link.ts). */
export function install(): void {
	watch_frames(peek);
	adopt_early_holes(runtime_session.visit.scope);
}

/**
 * SINGLE-FLIGHT NAVIGATION: batch a page's signed deferred endpoints into the store as one streamed
 * response (the navigation reaches it on the boot's link, ./boot-link.ts `frames_stream`, so an app
 * with `router` but no deferred/live/lake region never bundles the frame store). `visit`: the scope
 * of the page the holes are for (./session.ts `PageVisit`); the batch stops when it ends. Grouped as
 * the page's first holes are (frame-nav.ts `send_batches`, #987), naming `page`, the page they are
 * for, as their referrer (#995).
 */
export function stream(endpoints: string[], visit: Life, page: string): Promise<unknown> {
	return send_batches(endpoints, 'nav', visit, page);
}
