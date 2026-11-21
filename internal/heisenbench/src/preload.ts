/**
 * Loaded before a bench run (`node --import internal/heisenbench/src/preload.ts …`; the bench repo's
 * runner adds it whenever this file exists). Outside Vite, the specifiers only the plugin or Kit
 * serve (`ogygia:*`, `$app/*`) resolve to the unit-test stubs in packages/core/test/_stubs,
 * the same ones packages/core/vitest.config.ts aliases: `$app/env` -> app-env.ts,
 * `ogygia:server/sign` -> server.sign.ts; a stub's `.native` twin first, where one stands in for
 * production's native work a browser test cannot load (server.region-endpoint.native.ts: the island
 * fingerprint's SHA-1), so a bench counts what production runs. And the hydrate core's `svelte` resolves to a stand-in
 * for Svelte's client `hydrate` (svelte-hydrate.ts, below). And a bench page's island files, which a
 * browser fetches from the page's origin (runtime/code-origins.ts refuses any other), are the
 * stand-in island module, one instance per file: `<ISLAND_FILES><name>` -> island-module.ts?entry=<name>.
 * And a `.svelte` file a module imports (core's RenderSnippet.svelte) is compiled for the server by
 * core's own Svelte, as the app's Vite would. And a core file with macros loads as core's build
 * compiles it (./macros.ts). And each bench file loads in Node's own world: the globals an earlier
 * bench file of the run installed (a browser's, core's hydration benches) are taken off first.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createRequire, registerHooks, stripTypeScriptTypes } from 'node:module';
import { fileURLToPath } from 'node:url';
import { register_macro_mirror } from './macros.ts';

const core_require = createRequire(new URL('../../../packages/core/package.json', import.meta.url));
const { compile, compileModule } = core_require(
	'svelte/compiler'
) as typeof import('svelte/compiler');
const RUNES_MODULE_RE = /\.svelte\.(ts|js)$/;
/** What Heisenbench's counted code reaches its runtime by (its runtime/index.ts). */
const HEISENBENCH_RUNTIME = Symbol.for('heisenbench.runtime');

const STUBS = new URL('../../../packages/core/test/_stubs/', import.meta.url);
/** Core's source: its own `#` imports resolve to source there (package.json, `ogygia-source`), as
 *  core's tests resolve them; every other reader gets dist. */
const CORE_SRC = new URL('../../../packages/core/src/', import.meta.url).href;
/** Where the bench page's island files are (packages/core/bench/hydration-page.ts `island_file`). */
const ISLAND_FILES = 'https://shop.example.test/_app/ogygia/';
const APP = '$app/';
/** a realm module (`ogygia:server`) -> realm-server.ts; an entry by its own id -> <realm>.<id>.ts */
const REALM_RE = /^ogygia:(server|boot|region|dev)(?:\/(.+))?$/;

function stub_name(specifier: string): string | null {
	if (specifier.startsWith(APP)) return `app-${specifier.slice(APP.length)}`;
	const realm = REALM_RE.exec(specifier);
	if (realm) return realm[2] ? `${realm[1]}.${realm[2]}` : `realm-${realm[1]}`;
	return null;
}

/** The hydrate core's `svelte` (its `hydrate` / `unmount`): Node resolves Svelte's server build, where
 *  they throw, so the hydration benches get the stand-in (packages/core/test/_stubs/svelte-hydrate.ts).
 *  Every other module keeps the real `svelte`. */
const HYDRATE_CORE = '/packages/core/src/runtime/hydrate-core.ts';

function hydrate_core_import(context: { parentURL?: string }): boolean {
	const parent = context.parentURL;
	if (!parent) return false;
	const q = parent.indexOf('?');
	return (q === -1 ? parent : parent.slice(0, q)).endsWith(HYDRATE_CORE);
}

/** Heisenbench counts this run: it compiles every runes module it loads (each one it counts, and it
 *  counts every module but its own and the bench files), so this preload compiles none of them (a
 *  second compile fails on the first one's output). */
function counted(): boolean {
	return (globalThis as Record<symbol, unknown>)[HEISENBENCH_RUNTIME] !== undefined;
}

/** A bench file, as Heisenbench imports it (each fresh copy with its own query). */
const BENCH_FILE_RE = /\.bench\.[cm]?ts(?:\?|$)/;
/** ogygia's process slots (`slot()`, @ogygia/machine: `globalThis[Symbol.for('ogygia.…')]`). */
const SLOT_PREFIX = 'ogygia.';
/** Node's own globals a bench file replaced, as it found them (packages/core/bench/world.ts). */
const REPLACED = Symbol.for('ogygia.bench-world.replaced');

/** The world each bench file of a run loads in: Node's own, as in a run of that file alone. */
class BenchWorld {
	/** The globals the run had when its first bench file loaded. */
	static #own: ReadonlySet<string | symbol> | null = null;
	/** The bench file whose copies load now. */
	static #file: string | null = null;

	/**
	 * `url` (a bench file's copy) is about to load. When it is another file than the one before,
	 * every global the earlier files installed since the run's first one loaded is taken off: the
	 * browser a hydration bench installs (a server file after it reads no `window`: esm-env's
	 * BROWSER, the `typeof window` checks), and ogygia's process slots (the readers a server bench
	 * installed); and a global Node has that the file replaced (bench/world.ts) is Node's again.
	 * The copies of one file keep what their file installed, as in a run of it alone, so each case
	 * counts as it does there.
	 */
	static load(url: string): void {
		const q = url.indexOf('?');
		const file = q === -1 ? url : url.slice(0, q);
		const g = globalThis as unknown as Record<string | symbol, unknown>;
		if (BenchWorld.#own === null) BenchWorld.#own = new Set(Reflect.ownKeys(g));
		else if (file !== BenchWorld.#file) {
			const replaced = g[REPLACED] as Map<string, PropertyDescriptor> | undefined;
			for (const [name, own] of replaced ?? []) Object.defineProperty(g, name, own);
			for (const key of Reflect.ownKeys(g))
				if (!BenchWorld.#own.has(key) && BenchWorld.#installed(key)) delete g[key];
		}
		BenchWorld.#file = file;
	}

	/** Whether `key` is a global a bench file installs: a name, or one of ogygia's slots
	 *  (Heisenbench keeps its own state under its own symbols). */
	static #installed(key: string | symbol): boolean {
		return typeof key === 'string' || (key.description?.startsWith(SLOT_PREFIX) ?? false);
	}
}

registerHooks({
	resolve(specifier, context, next) {
		if (BENCH_FILE_RE.test(specifier)) BenchWorld.load(specifier);
		if (specifier === 'svelte' && hydrate_core_import(context))
			return { url: new URL('svelte-hydrate.ts', STUBS).href, shortCircuit: true };
		if (specifier.startsWith(ISLAND_FILES)) {
			const file = new URL('island-module.ts', STUBS);
			file.searchParams.set('entry', specifier.slice(ISLAND_FILES.length));
			return { url: file.href, shortCircuit: true };
		}
		if (specifier.startsWith('#') && context.parentURL?.includes(CORE_SRC))
			return next(specifier, {
				...context,
				conditions: ['ogygia-source', ...(context.conditions ?? [])]
			});
		const name = stub_name(specifier);
		if (name === null) return next(specifier, context);
		const native = new URL(`${name}.native.ts`, STUBS);
		if (existsSync(native)) return { url: native.href, shortCircuit: true };
		const file = new URL(`${name}.ts`, STUBS);
		if (!existsSync(file))
			throw new Error(`heisenbench preload: no stub for ${specifier} (expected ${file.pathname})`);
		return { url: file.href, shortCircuit: true };
	},
	load(url, context, next) {
		if (!url.startsWith('file:')) return next(url, context);
		const filename = fileURLToPath(url);
		if (filename.endsWith('.svelte')) {
			const { js } = compile(readFileSync(filename, 'utf8'), { generate: 'server', filename });
			return { format: 'module', source: js.code, shortCircuit: true };
		}
		const runes = RUNES_MODULE_RE.exec(filename);
		if (!runes || counted()) return next(url, context);
		const source = readFileSync(filename, 'utf8');
		const plain = runes[1] === 'ts' ? stripTypeScriptTypes(source, { mode: 'strip' }) : source;
		const { js } = compileModule(plain, { generate: 'server', filename });
		return { format: 'module', source: js.code, shortCircuit: true };
	}
});

register_macro_mirror();
