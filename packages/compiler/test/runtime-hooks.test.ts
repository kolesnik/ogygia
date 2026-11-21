// RUNTIME HOOKS (`ogygia:boot/hooks`, `ogygia:boot/hook-bits`, link/hooks.ts): the compiler reads
// which hooks each client realm subscribes to, and generates one module the boot calls directly (a
// hook no realm hears is `0`, so its call folds out) and one of `0`/`1` bits for the lazy chunks,
// which reach the hooks through the boot link. One list, read once; no define per hook, no registry
// filled at boot.
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { rolldown, type OutputChunk, type Plugin } from 'rolldown';
import {
	dedent,
	LAZY_HOOK_NAMES,
	RUNTIME_HOOK_NAMES,
	type RuntimeHookName
} from '@ogygia/core/contract';
import { generateHookBitsSource, generateHooksSource } from '../src/link/hooks.ts';
import {
	generateFeatureCodeSource,
	generateHydrateFeaturesSource,
	generateRemoteSeedsSource,
	generateRuntimeEntrySource,
	generateRuntimeFlagsSource,
	type RuntimeMarks
} from '../src/link/runtime-entry.ts';
import { core_defines } from '../src/virtual/core.ts';
import type { ClientRealmFile } from '../src/link/caps.ts';

const RUNTIME_DIR = fileURLToPath(new URL('../../core/dist/runtime', import.meta.url));
const realm = (name: string, hooks: RuntimeHookName[]): ClientRealmFile => ({
	name,
	module: `/app/node_modules/${name}/client.js`,
	hooks
});
/** The value `source` exports as `name`. */
const exported = (source: string, name: string) =>
	new RegExp(`^export const ${name} = (.+);$`, 'm').exec(source)?.[1];

describe('the generated hooks', () => {
	it('a hook a realm subscribes to is told; every other hook is 0', () => {
		const src = generateHooksSource(
			[realm('a', ['navigated', 'regionWoke']), realm('b', ['navigated', 'reloadNeeded'])],
			'/rt'
		);
		for (const h of RUNTIME_HOOK_NAMES)
			expect(exported(src, h), h).toBe(
				['navigated', 'regionWoke', 'reloadNeeded'].includes(h)
					? `/* @__PURE__ */ told("${h}")`
					: '0'
			);
		expect(src).toContain('import { told } from "/rt/hook-told.js";');
		expect(exported(src, 'realm_count')).toBe('2');
		expect(exported(src, 'lazy_hooks')).toBe('{ navigated }');
	});

	it('an app with no realm, or realms that subscribe to nothing, imports nothing and tells nothing', () => {
		for (const clients of [[], [realm('a', [])]]) {
			const src = generateHooksSource(clients, '/rt');
			expect(src).not.toContain('import');
			for (const h of RUNTIME_HOOK_NAMES) expect(exported(src, h), h).toBe('0');
			expect(exported(src, 'realm_count')).toBe(String(clients.length));
			expect(exported(src, 'lazy_hooks')).toBe('0');
		}
	});

	it('a lazy chunk’s bit is 1 exactly where a realm subscribes to its hook', () => {
		for (const h of LAZY_HOOK_NAMES) {
			const bits = generateHookBitsSource([realm('a', [h])]);
			for (const other of LAZY_HOOK_NAMES)
				expect(exported(bits, other), `${h}: ${other}`).toBe(other === h ? '1' : '0');
		}
		for (const h of LAZY_HOOK_NAMES) expect(exported(generateHookBitsSource([]), h)).toBe('0');
	});

	it('the dev runtime’s source is imported by its own extension', () => {
		expect(generateHooksSource([realm('a', ['warning'])], '/src/runtime', '.ts')).toContain(
			'"/src/runtime/hook-told.ts"'
		);
	});
});

// ── built: core's runtime as an app's build bundles it ──────────────────────────────────────────

const MARKS: RuntimeMarks = { complete: true, hydrate: ['load'], defer: ['load'], router: true };

/** The boot realm as the plugin serves it, for `clients`. */
function boot_realm(clients: readonly ClientRealmFile[]): Plugin {
	const hooks = generateHooksSource(clients, RUNTIME_DIR);
	const ids: Record<string, string> = {
		'ogygia:boot': dedent`
			export { HAS, load_wire_codec } from 'ogygia:boot/runtime-flags';
			export const region_names = {};
		`,
		'ogygia:boot/runtime-flags': generateRuntimeFlagsSource(MARKS, RUNTIME_DIR),
		'ogygia:boot/feature-code': generateFeatureCodeSource(MARKS, RUNTIME_DIR),
		'ogygia:boot/hydrate-features': generateHydrateFeaturesSource(MARKS, RUNTIME_DIR).code,
		'ogygia:boot/remote-seeds': generateRemoteSeedsSource(MARKS, RUNTIME_DIR),
		'ogygia:boot/hooks': hooks,
		'ogygia:boot/hook-bits': generateHookBitsSource(clients)
	};
	return {
		name: 'test:boot-realm',
		resolveId: (id) => (id in ids ? `\0${id}` : null),
		load: (id) => (id.startsWith('\0') ? (ids[id.slice(1)] ?? null) : null)
	};
}

/** The runtime built for an app whose one client realm subscribes to `subscribed`. */
async function build(subscribed: readonly RuntimeHookName[]): Promise<OutputChunk[]> {
	const dir = mkdtempSync(join(tmpdir(), 'og-hooks-'));
	const client = join(dir, 'client.mjs');
	writeFileSync(
		client,
		`export default { hooks: { ${subscribed.map((h) => `${h}: (e) => globalThis.heard?.(e)`).join(', ')} } };\n`
	);
	const clients = [{ name: 'a', module: client, hooks: subscribed }];
	const entry = join(dir, 'entry.mjs');
	writeFileSync(entry, generateRuntimeEntrySource(MARKS, RUNTIME_DIR, clients).code);
	const bundle = await rolldown({
		input: entry,
		external: [/^svelte(\/|$)/, /^\$app\//, /\.svelte$/, /^ogygia:region(\/|$)/],
		resolve: { conditionNames: ['browser', 'production', 'import', 'default'] },
		plugins: [boot_realm(clients)],
		preserveEntrySignatures: 'strict',
		transform: {
			define: {
				'import.meta.env.DEV': 'false',
				'import.meta.env.MODE': '"production"',
				__OGYGIA_BEACON__: 'false',
				...core_defines({
					continuity_forms: true,
					server_delta: false,
					devtools: false,
					devtools_lazy: false,
					rules: false,
					kit_major: 2,
					kit_pages: true,
					version: '0.0.0',
					dev_server: false
				})
			}
		},
		logLevel: 'silent'
	});
	const { output } = await bundle.generate({ format: 'es', minify: true });
	await bundle.close();
	return output.filter((o): o is OutputChunk => o.type === 'chunk');
}
const code = (chunks: OutputChunk[]) => chunks.map((c) => c.code).join('\n');

describe('the hooks in a build', () => {
	it('a build where no realm subscribes carries no hook code; each subscribed hook brings its own', async () => {
		const none_chunks = await build([]);
		const none = code(none_chunks);
		const all_chunks = await build(RUNTIME_HOOK_NAMES);
		const all = code(all_chunks);
		const hydrated = code(await build(['regionHydrated']));
		// (whole names: `regionHydrate` is a prefix of `regionHydrated`)
		const named = (hook: string) => new RegExp(`\\b${hook}\\b`);
		for (const hook of RUNTIME_HOOK_NAMES) {
			expect(none, hook).not.toMatch(named(hook));
			expect(all, hook).toMatch(named(hook));
		}
		for (const fan_out of ['tLoaded:', 'finalPath:', 'finalUrl:'])
			expect(none, fan_out).not.toContain(fan_out);
		// (a plugin's boot is isolated as a hook is: a throw is reported, the regions still wake)
		expect(none).toContain('client_hook_failed');
		expect(hydrated).toContain('regionHydrated');
		expect(hydrated).toContain('tLoaded:');
		for (const other of RUNTIME_HOOK_NAMES.filter((h) => h !== 'regionHydrated'))
			expect(hydrated, other).not.toMatch(named(other));
		expect(none.length).toBeLessThan(hydrated.length);
		// every hook on, a lazy chunk shares no module more with the boot: not one chunk more
		const files = (chunks: OutputChunk[]) => chunks.map((c) => c.name).sort();
		expect(files(all_chunks)).toEqual(files(none_chunks));
	}, 60_000);

	it('reloadNeeded folds out unless a realm subscribes, and brings its region lookup with it', async () => {
		const none = code(await build([]));
		const subscribed = code(await build(['reloadNeeded']));
		expect(none).not.toMatch(/\breloadNeeded\b/);
		expect(subscribed).toMatch(/\breloadNeeded\b/);
		expect(subscribed).toContain('og-retry');
		expect(none.length).toBeLessThan(subscribed.length);
	}, 60_000);
});
