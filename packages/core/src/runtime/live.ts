/**
 * Live-region feature: a held region's ticks (./live-program.ts), and the pushable props a live
 * `<Region>` and a kept island hydrate with, so later `query.live` ticks (and the next page's
 * props) reach the mounted island in place instead of re-hydrating it.
 *
 * A HYDRATE-phase feature (link/runtime-entry.ts): installed by the hydrate core, never the boot.
 */
import { slots } from './slots.ts';
import { PushableProps } from './pushable-props.svelte.ts';
import { apply_live } from './live-program.ts';

/** Feature entry: fill the `Pushable` slot with {@link PushableProps}, and the live program's. */
export function install(): void {
	slots.Pushable = PushableProps;
	slots.live_program = apply_live;
}
