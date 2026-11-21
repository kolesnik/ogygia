/**
 * Kitchen-sink browser runtime: every BOOT-phase feature. The dev / no-marks entry: the ogygia
 * compiler injects `bootDev()` (see the plugin's `ogygia:boot/runtime`); a per-app production build
 * instead emits a generated entry (see `vite/runtime-entry.ts`). Both boot through {@link ./core.js
 * core}, which installs the features `ogygia:boot/feature-code` holds (every one, in dev).
 * HYDRATE-phase features (context, live, wire, remote-seeds, page) are never in the boot, dev
 * included: the hydrate core installs them from `ogygia:boot/hydrate-features` (every one, in dev).
 *
 * Exposed as an explicit FUNCTION, not a top-level side effect: the compiler always calls it, so the
 * boot never depends on a bundler honouring `sideEffects` to survive tree-shaking / dep-prebundling.
 */
import { boot } from './core.ts';
import type { ClientRealm } from './client-plugins.ts';

/** Boot the kitchen-sink runtime (all boot-phase features) with the plugins' browser halves.
 *  Idempotent via {@link ./core.js boot}. */
export function bootDev(client_plugins: readonly ClientRealm[] = []): void {
	boot(client_plugins);
}
