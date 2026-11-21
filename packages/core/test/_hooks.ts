// The runtime hooks a test hears: its own client realm, handed to the boot as an app's entry hands
// the app's (runtime/client-plugins.ts), with exactly those hooks subscribed in the
// `ogygia:boot/hooks` stub, so each one reaches it through the runtime's own `told` and every
// other one stays `0` (folded, as in an app whose realms do not subscribe).
import { boot_client_plugins, type ClientRealm } from '../src/runtime/client-plugins.ts';
import type { RuntimeHookName, RuntimeHooks } from '../src/contract/runtime-hooks.ts';
import { subscribe } from './_stubs/boot.hooks.ts';

/** The test's realm hears `hooks`, and no other hook is heard, until the next call. */
export function hear(hooks: Partial<RuntimeHooks>): void {
	subscribe(Object.keys(hooks) as RuntimeHookName[]);
	boot_client_plugins([{ name: 'test', client: { hooks } }], false);
}

/** No hook is heard. */
export function hear_none(): void {
	subscribe([]);
	boot_client_plugins([], false);
}

/** The hooks `realms` list subscribed, as the compiler subscribes them from each realm's file
 *  (then the boot hands the realms over: `bootDev(realms)`). */
export function subscribe_realms(realms: readonly ClientRealm[]): void {
	subscribe(realms.flatMap((r) => Object.keys(r.client.hooks ?? {})) as RuntimeHookName[]);
}
