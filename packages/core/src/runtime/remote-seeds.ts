/**
 * Remote-seeds feature: seed the reused Kit client query cache from the server's
 * `application/ogygia-remote` script, once per document and again after a navigation replaced the
 * page (test/remote-seeds.test.ts). A hydrate-phase feature, never in the boot
 * (test/runtime-boot-svelte-free.test.ts).
 *
 * @packageDocumentation
 */
import { boot_link, slots } from './slots.ts';
import { L_RUNTIME_SESSION, L_SERVER_CHANNEL } from './boot-link-index.ts';
import { seed_query_responses } from '../shims/kit-remote/client-stub.ts';
import { clear_remote_seeds, release_remote_instances } from '../shims/kit-remote/remote-cache.ts';

const REMOTE_SEED_SELECTOR = 'script[type="application/ogygia-remote"]';

function seed_once(): void {
	const session = boot_link()[L_RUNTIME_SESSION];
	if (session.remote_seeded) return;
	session.mark_remote_seeded();
	if (typeof document === 'undefined') return;
	const text = boot_link()[L_SERVER_CHANNEL](document, REMOTE_SEED_SELECTOR)?.textContent;
	if (text) seed_query_responses(text);
}

/** Feature entry: fill the `remoteSeeds` slot. */
export function install(): void {
	slots.remoteSeeds = {
		seed_once,
		seed_query_responses,
		clear_remote_seeds,
		release_remote_instances
	};
}
