/**
 * Live-region feature: a held region's ticks (./live-program.ts), and the pushable props a live
 * `<Region>` and a kept island hydrate with, so later `query.live` ticks (and the next page's
 * props) reach the mounted island in place instead of re-hydrating it.
 *
 * A HYDRATE-phase feature (link/runtime-entry.ts): read by the hydrate core
 * (`ogygia:boot/hydrate-features`), never the boot.
 */
export { PushableProps } from './pushable-props.svelte.ts';
export { apply_live } from './live-program.ts';
