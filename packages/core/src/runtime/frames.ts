import { slots } from './slots.ts';
import { subscribe, peek, ticket } from './frame-store.ts';
import { watch_frames } from './rules.ts';
import { send_batches } from './frame-nav.ts';
import { adopt_early_holes } from './early-holes.ts';
import { runtime_session } from './session.ts';

export { subscribe, peek, ticket, ensure, renew, renewal } from './frame-store.ts';
export { batch_times, join_batch } from './frame-nav.ts';

/** Feature entry: the frame store's watch and the early holes, and the `frames` slot for the lazy
 *  chunks (the live program, the router's navigation). The region element calls the store directly
 *  (`ogygia:boot/feature-code`). */
export function install(): void {
	watch_frames(peek);
	adopt_early_holes(runtime_session.visit.scope);
	slots.frames = {
		subscribe,
		peek,
		ticket,
		stream: (endpoints, visit, page) => send_batches(endpoints, 'nav', visit, page)
	};
}
