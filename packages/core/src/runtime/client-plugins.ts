import { isolated, Realms, type ClientRealm } from './hook-told.ts';

export type { ClientRealm };

/** Hand the app's client realms to the hooks (./hook-told.ts), then boot each plugin's browser
 *  half (the runtime's boot, or a Kit-owned page's). */
export function boot_client_plugins(list: readonly ClientRealm[], kit_page: boolean): void {
	Realms.set(list);
	const boot = isolated('boot');
	for (const { name, client } of list)
		if (client.boot) boot(name, () => client.boot?.({ kitPage: kit_page }));
}
