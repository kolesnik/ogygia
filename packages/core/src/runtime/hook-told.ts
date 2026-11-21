import type { ClientPlugin } from '../plugin/client.ts';
import type { RuntimeHookName, RuntimeHooks } from '../contract/runtime-hooks.ts';
import { OgygiaError } from '../messages/core.ts';

/** A plugin's browser half, with the plugin's name, as the boot entry hands it over. */
export interface ClientRealm {
	readonly name: string;
	readonly client: ClientPlugin;
}

type Payload<K extends RuntimeHookName> = Parameters<RuntimeHooks[K]>[0];

/** The app's client realms, once the boot handed them over (./client-plugins.ts), in the order the
 *  entry imported them: the realms each {@link told} hook tells. */
export class Realms {
	static list: readonly ClientRealm[] = [];
	static set(list: readonly ClientRealm[]): void {
		Realms.list = list;
	}
}

/** Runs `run` for `plugin` inside `hook`: a throw or a rejection is reported once per plugin and
 *  hook (`client_hook_failed`), and never reaches the runtime. */
export function isolated(
	hook: RuntimeHookName | 'boot'
): (plugin: string, run: () => unknown) => unknown {
	const failed = new Set<string>();
	const report = (plugin: string, err: unknown) => {
		if (failed.has(plugin)) return;
		failed.add(plugin);
		console.error(new OgygiaError('client_hook_failed', { plugin, hook }), err);
	};
	return (plugin, run) => {
		try {
			const out = run();
			if (typeof (out as PromiseLike<unknown> | undefined)?.then === 'function')
				Promise.resolve(out).catch((err: unknown) => report(plugin, err));
			return out;
		} catch (err) {
			report(plugin, err);
		}
	};
}

/** The hook `name`, told to every realm that subscribes, in realm order: what the compiler's
 *  `ogygia:boot/hooks` makes each hook the app's realms subscribe to (every other is `0`). A subscriber may answer
 *  with a function (`regionHydrate`'s after): the call returns one that runs them all. One may
 *  answer with a promise (`answerParsed`'s wait): the call returns one that settles when they all
 *  have, a rejection reported and waited past. Otherwise it returns nothing. */
export function told<K extends RuntimeHookName>(name: K): RuntimeHooks[K] {
	const call = isolated(name);
	return ((e: Payload<K>) => {
		if (import.meta.env.DEV) Object.freeze(e);
		let afters: { plugin: string; f: () => unknown }[] | undefined;
		let waits: Promise<unknown>[] | undefined;
		for (const { name: plugin, client } of Realms.list) {
			const f = client.hooks?.[name] as ((e: Payload<K>) => unknown) | undefined;
			if (!f) continue;
			const out = call(plugin, () => f(e));
			if (typeof out === 'function') (afters ??= []).push({ plugin, f: out as () => unknown });
			else if (typeof (out as PromiseLike<unknown> | undefined)?.then === 'function')
				// oxlint-disable-next-line ogygia/no-silent-failures -- isolated() reported the rejection (client_hook_failed); the answer goes on without that subscriber
				(waits ??= []).push(Promise.resolve(out).then(noop, noop));
		}
		if (afters) {
			const all = afters;
			return () => {
				for (const a of all) call(a.plugin, a.f);
			};
		}
		if (waits) return Promise.all(waits).then(noop);
	}) as RuntimeHooks[K];
}

function noop(): void {}
