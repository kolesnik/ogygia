/**
 * The boot's link as the runtime's lazy chunks hold it (./boot-link.ts `BootLink`). The boot hands
 * it to each lazy chunk as it imports one (`m.init(link_boot())`: the hydrate core, the router's
 * navigation, interaction replay), and every module those chunks share reads it here. The boot
 * never imports this module: test/runtime-boot-svelte-free.test.ts.
 *
 * @internal
 */
import type { BootLink } from './boot-link.ts';

let link: BootLink | null = null;

/** Take the boot's link: what a lazy chunk's `init` does as the boot imports it. */
export function init(boot: BootLink): void {
	link = boot;
}

/** The boot's link, once a lazy chunk was handed it. */
export function boot_link(): BootLink {
	if (link === null) throw new Error('[ogygia] https://ogygiajs.dev/e/slot_not_linked?name=boot');
	return link;
}

/** The boot's link, or `null` where no boot handed one (the server's render, a harness). */
export function boot_link_or_null(): BootLink | null {
	return link;
}
