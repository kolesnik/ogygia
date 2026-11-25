import { LAZY_HOOK_NAMES, RUNTIME_HOOK_NAMES, type RuntimeHookName } from '@ogygia/core/contract';
import type { ClientRealmFile } from './caps.ts';
import { runtime_path } from './runtime-entry.ts';

function subscribed_by(clients: readonly ClientRealmFile[]): Set<RuntimeHookName> {
	return new Set(clients.flatMap((c) => c.hooks));
}

/**
 * Emit `ogygia:boot/hooks`: each runtime hook the app's client realms subscribe to, as the runtime's
 * `told` function (it tells every realm that subscribes, in realm order), and every other hook `0`,
 * so the runtime's `if (hook) hook(…)` folds out where nobody hears it. `realm_count`: how many
 * realms the entry hands the boot. `lazy_hooks`: the lazy chunks' hooks the realms subscribe to,
 * as one object for the boot link (`0`: none).
 * @param runtimeDir Absolute directory containing the runtime's modules (`hook-told.js`).
 */
export function generateHooksSource(
	clients: readonly ClientRealmFile[],
	runtimeDir: string,
	ext = '.js'
): string {
	const on = subscribed_by(clients);
	const lines: string[] = [];
	if (on.size)
		lines.push(
			`import { told } from ${JSON.stringify(runtime_path(runtimeDir, `hook-told${ext}`))};`
		);
	for (const name of RUNTIME_HOOK_NAMES)
		lines.push(
			on.has(name)
				? `export const ${name} = /* @__PURE__ */ told(${JSON.stringify(name)});`
				: `export const ${name} = 0;`
		);
	lines.push(`export const realm_count = ${clients.length};`);
	const lazy = LAZY_HOOK_NAMES.filter((h) => on.has(h));
	lines.push(`export const lazy_hooks = ${lazy.length ? `{ ${lazy.join(', ')} }` : '0'};`);
	return `${lines.join('\n')}\n`;
}

/**
 * Emit `ogygia:boot/hook-bits`: each lazy chunk's hook as `1` where a client realm subscribes to it,
 * else `0`. One character each: the bundler inlines a shared constant that short into every chunk
 * that reads it, so a lazy chunk imports no module of the boot's (no extra file under Kit's
 * chunking), and its `if (HOOK_X)` folds as the boot's `if (hook)` does.
 */
export function generateHookBitsSource(clients: readonly ClientRealmFile[]): string {
	const on = subscribed_by(clients);
	return `${LAZY_HOOK_NAMES.map((h) => `export const ${h} = ${on.has(h) ? 1 : 0};`).join('\n')}\n`;
}
