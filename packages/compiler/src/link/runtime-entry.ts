import {
	dedent,
	feature_word,
	F_FRAMES,
	F_LAKES,
	F_LIVE,
	parse_trigger,
	WAKE,
	type FeatureName
} from '@ogygia/core/contract';
import { client_realms_source, type ClientRealmFile } from './caps.ts';

const HYPHEN = /-/g;
const BACKSLASH = /\\/g;

/**
 * Runtime feature catalog — maps build-time marks → installable plugins.
 * Module paths are absolute file URLs resolved by the Vite plugin against dist/src.
 */

export type RuntimeMarks = {
	/** When false/undefined, emit kitchen-sink (safe default). */
	complete?: boolean;
	hydrate?: string[];
	defer?: string[];
	/** A hole's `prefetch` schedules (warming its HTML ahead of its `fetch`). */
	prefetch?: string[];
	/** A lake's `remount.revalidate` schedules (a cached lake fetched again). */
	revalidate?: string[];
	persist?: boolean;
	persistKeys?: string[];
	router?: boolean;
	live?: boolean;
	morph?: boolean;
	lakes?: boolean;
	forms?: boolean;
	wire?: boolean;
	remoteSeeds?: boolean;
	/** App imports an ogygia context provider (`Provide` / `setContext` / `createContext`). Set by the
	 *  driver's import scan; gates the cross-island context bridge (~4.7 kB) out of apps that never
	 *  provide context. Read-only providers (`getContext`) don't set it — there's nothing to bridge. */
	context?: boolean;
	/** Island code can reach Kit's page world: `$app/state` / `$app/stores` / `$app/navigation`
	 *  (anything under `$app/` but `environment` and `paths`), or code the driver's island-closure walk
	 *  cannot follow (a package, an unresolvable import), or federation, which hands the runtime
	 *  islands the walk never saw. Gates the page seed and the MPA navigation handle. */
	page?: boolean;
	/** The page can carry regions this build never compiled (federation: a peer's fragment brings its
	 *  own islands, holes and lakes, at run time). Their kinds are unknown here, so every feature a
	 *  region in the HTML can need is in: test/page-mark.test.ts › "foreign regions" (#909, #1931).
	 *  Two are not: `wire` loads on use (`load_wire_codec`), and `wire-classes` loads only this
	 *  build's own classes, which a peer's props never name. */
	foreign?: boolean;
};

/** A runtime feature, numbered by core's feature word (`@ogygia/core/contract` features.ts). */
export type FeatureId = FeatureName;

/**
 * WHICH CHUNK a feature lives in. The runtime ships as two static, feature-sized phases (and code
 * the element itself keeps or folds):
 *
 * - `boot` — the runtime entry (`og-runtime.*.js`), loaded by the `<script>` in `<head>`. Defines
 *   `<ogygia-region>`, schedules wakes, fetches holes, morphs, routes. It must never reach Svelte:
 *   in a real app Svelte's client runtime is ONE shared chunk (~200 KB), and anything in the boot's
 *   static graph downloads first, ahead of the page's own LCP image, before any island needs it.
 * - `hydrate` — the hydrate core (`runtime/hydrate-core.js`), loaded by the runtime's single existing
 *   `import()` when the first island wakes, together with Svelte (which `hydrate()` needs anyway). A
 *   feature whose slot only the hydrate core reads belongs here, installed as the chunk evaluates.
 * - `element` — no module: code inside the always-on region element, kept or folded by the
 *   feature's bit in `HAS` alone (a schedule's arm: `idle`, `visible`, `media`; the island graph's
 *   reader: `graph`).
 *
 * Both phases are generated from the same marks, so each is exactly as big as the app needs; no
 * feature adds a dynamic import of its own. `test/runtime-boot-svelte-free.test.ts` pins the boot.
 */
export type FeaturePhase = 'boot' | 'hydrate' | 'element';

export type FeatureDef = {
	/** Path relative to `runtime/` (no leading ./). None for an `element` feature. */
	module?: string;
	deps: FeatureId[];
	detect: (m: RuntimeMarks) => boolean;
	/** Default `boot`. See {@link FeaturePhase}. */
	phase?: FeaturePhase;
};

function schedules(m: RuntimeMarks): string[] {
	return [...(m.hydrate || []), ...(m.defer || []), ...(m.prefetch || []), ...(m.revalidate || [])];
}

function schedules_unseen(m: RuntimeMarks): boolean {
	return m.foreign === true || m.live === true;
}

export const FEATURES: Record<FeatureId, FeatureDef> = {
	interaction: {
		module: 'interaction.js',
		deps: [],
		detect: (m) => m.foreign === true || (m.hydrate || []).some((w) => w !== 'none')
	},
	forms: {
		module: 'form-continuity.js',
		deps: [],
		detect: (m) => m.forms === true || (m.forms !== false && m.router === true)
	},
	'mpa-nav': {
		module: 'nav-handle.js',
		deps: [],
		detect: (m) => m.page !== false && m.router !== true
	},
	router: {
		module: 'router.js',
		deps: [],
		detect: (m) => m.router === true
	},
	lakes: {
		module: 'lakes.js',
		deps: [],
		detect: (m) => m.foreign === true || m.lakes === true || (m.hydrate || []).includes('none')
	},
	morph: {
		module: 'morph.js',
		deps: [],
		detect: (m) =>
			m.foreign === true ||
			m.live === true ||
			m.morph === true ||
			m.router === true ||
			(m.defer || []).length > 0
	},
	live: {
		module: 'live.js',
		deps: [],
		phase: 'hydrate',
		detect: (m) =>
			m.foreign === true ||
			m.live === true ||
			m.persist === true ||
			(m.persistKeys || []).length > 0
	},
	wire: {
		module: '../live-transport.js',
		deps: [],
		phase: 'hydrate',
		detect: (m) => m.wire === true
	},
	'wire-classes': {
		module: 'wire-classes.js',
		deps: [],
		detect: (m) => m.wire === true
	},
	'remote-seeds': {
		module: 'remote-seeds.js',
		deps: [],
		phase: 'hydrate',
		detect: (m) => m.remoteSeeds !== false
	},
	page: {
		module: 'seeds.js',
		deps: [],
		phase: 'hydrate',
		detect: (m) => m.page !== false
	},
	frames: {
		module: 'frames.js',
		deps: [],
		detect: (m) =>
			m.foreign === true ||
			(m.defer || []).length > 0 ||
			m.live === true ||
			m.morph === true ||
			m.lakes === true
	},
	context: {
		module: 'context.js',
		deps: [],
		phase: 'hydrate',
		detect: (m) => m.foreign === true || m.context === true
	},
	idle: {
		deps: [],
		phase: 'element',
		detect: (m) => schedules_unseen(m) || schedules(m).includes('idle')
	},
	visible: {
		deps: [],
		phase: 'element',
		detect: (m) => schedules_unseen(m) || schedules(m).includes('visible')
	},
	graph: {
		deps: [],
		phase: 'element',
		detect: (m) => schedules_unseen(m) || (m.hydrate || []).some((w) => w !== 'none')
	},
	media: {
		deps: [],
		phase: 'element',
		detect: (m) =>
			schedules_unseen(m) || schedules(m).some((w) => parse_trigger(w, WAKE)?.on === 'media')
	}
};

export const FEATURE_ORDER: FeatureId[] = [
	'remote-seeds',
	'page',
	'wire',
	'wire-classes',
	'frames',
	'lakes',
	'morph',
	'live',
	'interaction',
	'forms',
	'mpa-nav',
	'router',
	'context',
	'idle',
	'visible',
	'media',
	'graph'
];

/** Resolve the closed feature set for a marks manifest. */
export function resolveFeatures(marks: RuntimeMarks): FeatureId[] {
	if (!marks.complete) return [...FEATURE_ORDER];

	const selected = new Set<FeatureId>();
	for (const id of FEATURE_ORDER) {
		if (FEATURES[id].detect(marks)) selected.add(id);
	}

	let changed = true;
	while (changed) {
		changed = false;
		for (const id of Array.from(selected)) {
			for (const d of FEATURES[id].deps) {
				if (!selected.has(d)) {
					selected.add(d);
					changed = true;
				}
			}
		}
	}

	return FEATURE_ORDER.filter((id) => selected.has(id));
}

const to_alias = (id: string) => id.replace(HYPHEN, '_');
/** A runtime module's path in `runtimeDir`, as an import names it (POSIX). */
export const runtime_path = (runtimeDir: string, mod: string): string =>
	`${runtimeDir}/${mod}`.replace(BACKSLASH, '/');

/** The selected features of one {@link FeaturePhase}, in FEATURE_ORDER. */
export function phaseFeatures(marks: RuntimeMarks, phase: FeaturePhase): FeatureId[] {
	return resolveFeatures(marks).filter((id) => (FEATURES[id].phase ?? 'boot') === phase);
}

/**
 * Emit the BOOT entry: core + the selected boot-phase features (see {@link FeaturePhase}). The
 * entry boots and exports nothing.
 * @param runtimeDir Absolute directory containing `core.js` + the feature modules.
 * @param clientPlugins the plugins' browser halves, in plugin order
 */
export function generateRuntimeEntrySource(
	marks: RuntimeMarks,
	runtimeDir: string,
	clientPlugins: readonly ClientRealmFile[] = []
): { code: string; features: FeatureId[] } {
	const cp = client_realms_source(clientPlugins);
	const features = phaseFeatures(marks, 'boot');
	const lines: string[] = [];
	lines.push(`/** generated ogygia runtime — features: ${features.join(', ') || '(core only)'} */`);
	lines.push(`import { boot } from ${JSON.stringify(runtime_path(runtimeDir, 'core.js'))};`);
	for (const id of features) {
		lines.push(
			`import * as ${to_alias(id)} from ${JSON.stringify(runtime_path(runtimeDir, FEATURES[id].module!))};`
		);
	}
	if (cp.imports) lines.push(cp.imports.slice(0, -1));
	lines.push('');
	lines.push('boot([');
	for (const id of features) lines.push(`  ${to_alias(id)}.install,`);
	lines.push(cp.list ? `], ${cp.list});` : ']);');
	return { code: `${lines.join('\n')}\n`, features };
}

/**
 * Emit the HYDRATE-phase feature module (`ogygia:boot/hydrate-features`), which the hydrate core
 * imports statically and installs as its chunk evaluates — so these features ride the hydrate core's
 * one existing `import()`, sized by the same marks as the boot. `all` (dev / no marks): every one.
 * @param runtimeDir Absolute directory containing the feature modules.
 */
export function generateHydrateFeaturesSource(
	marks: RuntimeMarks,
	runtimeDir: string,
	all = false
): { code: string; features: FeatureId[] } {
	const features = all
		? FEATURE_ORDER.filter((id) => FEATURES[id].phase === 'hydrate')
		: phaseFeatures(marks, 'hydrate');
	const lines: string[] = [];
	lines.push(`/** generated ogygia hydrate-phase features: ${features.join(', ') || '(none)'} */`);
	for (const id of features) {
		lines.push(
			`import * as ${to_alias(id)} from ${JSON.stringify(runtime_path(runtimeDir, FEATURES[id].module!))};`
		);
	}
	lines.push('export function install() {');
	for (const id of features) lines.push(`  ${to_alias(id)}.install();`);
	lines.push('}');
	return { code: `${lines.join('\n')}\n`, features };
}

/**
 * Emit `ogygia:boot/runtime-flags`: build-time constants for code that lives INSIDE the always-on
 * region element rather than in a feature module, because it works on the element's own state. The
 * bundler inlines an imported `const` and drops the branches it switches off, so the code a flag
 * guards ships exactly when the feature it serves does. Same marks as the entries; `all` (dev / no
 * marks): every flag on.
 *
 * - `HAS`: the build's feature word, a bit per selected feature (core contract/features.ts). The
 *   element tests it: without `F_FRAMES` (no region streams HTML: a deferred hole, a live region, a
 *   lake) a region's fetch has nowhere to land, so its fetch / apply / morph / renew path is dead
 *   code. `all`: every feature's bit.
 * - `load_wire_codec`: `null` where the `wire` feature (the codec) is in the build up front, else
 *   the codec's `import()`, for a wake whose props carry a live value the marks did not predict
 *   (core runtime/wire-on-use.ts). Generated here, not written in core, so a build with the codec
 *   has no `import()` of it in the boot's graph: that edge alone splits the boot's shared chunk in
 *   two (apps/palaestra/e2e/lazy-chunks.spec.ts, the boot-file budget).
 * @param runtimeDir Absolute directory containing `core.js` + the feature modules.
 */
export function generateRuntimeFlagsSource(
	marks: RuntimeMarks,
	runtimeDir: string,
	all = false
): string {
	const features = all ? FEATURE_ORDER : resolveFeatures(marks);
	const codec = JSON.stringify(runtime_path(runtimeDir, FEATURES.wire.module!));
	const load_wire_codec = features.includes('wire') ? 'null' : `() => import(${codec})`;
	return `${dedent`
		export const HAS = ${feature_word(features)};
		export const load_wire_codec = ${load_wire_codec};
	`}\n`;
}

/** The server's feature word for `marks` (`all`: every feature), as
 *  {@link generateServerFlagsSource} writes it. */
export function server_feature_word(marks: RuntimeMarks, all = false): number {
	return feature_word(all ? FEATURE_ORDER : resolveFeatures(marks));
}

/**
 * Emit `ogygia:server/runtime-flags`: the same feature word as the browser's `HAS`
 * ({@link generateRuntimeFlagsSource}), for the server build. The server's code for a feature (a
 * hole's render and endpoint, a lake's, a live region's) is written against it, so a server only
 * writes into a page what the page's runtime can revive. The marks only grow while a build runs and
 * the server leg reads them first, so its word never holds a feature the browser's lacks.
 */
export function generateServerFlagsSource(marks: RuntimeMarks, all = false): string {
	return `export const HAS = ${server_feature_word(marks, all)};\n`;
}

/**
 * Emit `ogygia:region/programs`: the three programs a region's render writes for, as booleans, on
 * each leg from the same marks as its word ({@link generateRuntimeFlagsSource},
 * {@link generateServerFlagsSource}). `HAS_FRAMES` (a hole's fetch, a deferred region's),
 * `HAS_LAKES`, `HAS_LIVE` (a held region's updates). Region.svelte reads them in both realms, so a
 * region whose program the build left out renders its waiting UI on the server and in the browser
 * alike (a hydration that agrees), and the browser's island code drops the branches they switch off.
 */
export function generateProgramsSource(marks: RuntimeMarks, all = false): string {
	const word = feature_word(all ? FEATURE_ORDER : resolveFeatures(marks));
	return `${dedent`
		export const HAS_FRAMES = ${(word & F_FRAMES) !== 0};
		export const HAS_LAKES = ${(word & F_LAKES) !== 0};
		export const HAS_LIVE = ${(word & F_LIVE) !== 0};
	`}\n`;
}
