/**
 * Live-region feature: the pushable props a live `<Region>` and a kept island hydrate with, so later
 * `query.live` ticks (and the next page's props) reach the mounted island in place instead of
 * re-hydrating it. A held region's ticks run the live program (./live-program.ts), its own lazy chunk:
 * the element loads it at its first tick (./core.ts `#apply_live`), so a wake on a page without a live
 * region never downloads it.
 *
 * A HYDRATE-phase feature (link/runtime-entry.ts): installed by the hydrate core, never the boot.
 */
import { slots } from './slots.ts';
import { PushableProps } from './pushable-props.svelte.ts';

/** Feature entry: fill the `Pushable` slot with {@link PushableProps}. */
export function install(): void {
	slots.Pushable = PushableProps;
}
