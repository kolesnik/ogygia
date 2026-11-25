/**
 * `context` feature — the cross-island context bridge.
 *
 * The DOM walk that seeds each island's `getContext` from a `<Provide>` / drop-in-`setContext`
 * marker above it (see `../context-bridge.js`). Included only when the build finds an app file that
 * reaches an ogygia context provider — `Provide`, `setContext`, or `createContext`, in any import
 * form (the compiler's link/own-reach.ts). A plain app that never bridges context leaves the ~4.7 kB
 * bridge out: the hydrate core reads `null` for it, and its absence is just "no provider above" —
 * the common, already-handled case.
 *
 * A HYDRATE-phase feature (link/runtime-entry.ts): read by the hydrate core
 * (`ogygia:boot/hydrate-features`), never the boot.
 */
export { collect_provided_context } from '../context-bridge.ts';
