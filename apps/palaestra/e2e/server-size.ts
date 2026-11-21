#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// ogygia — server bundle size: what ogygia's packages put into an app's SSR build.
//
// Builds the app, the palaestra unless `--app` (`vite build --sourcemap hidden`: the .js files are the
// bytes a plain build writes, the maps sit beside them), reads every .js of .svelte-kit/output/server
// with its map, and
// gives each byte to the module that wrote it. ogygia's share is every module under packages/
// (core's dist, machine's src as the workspace resolves it), by package and by module, raw and brotli
// (each package's text compressed as one stream, in output order).
//
//   node apps/palaestra/e2e/server-size.ts               # build, measure, print
//   node apps/palaestra/e2e/server-size.ts --no-build    # measure the output already there
//   node apps/palaestra/e2e/server-size.ts --json        # machine-readable
//   node apps/palaestra/e2e/server-size.ts --compare <json>   # each number beside another run's --json
//   node apps/palaestra/e2e/server-size.ts --top <n>     # the n largest modules (default 25)
//   node apps/palaestra/e2e/server-size.ts --app apps/plain-islands   # another app's server build
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync } from 'node:zlib';
import { mapped_text } from './_sourcemap.ts';

const arg = (flag: string): string | undefined => {
	const at = process.argv.indexOf(flag);
	return at === -1 ? undefined : process.argv[at + 1];
};

const REPO = fileURLToPath(new URL('../../..', import.meta.url));
/** `--app <dir>`: another app of the repository (apps/plain-islands: a plain ogygia app, none of the
 *  frames, lakes or live features the palaestra holds). */
const APP = arg('--app') ? resolve(arg('--app')!) : join(REPO, 'apps/palaestra');
const SERVER = join(APP, '.svelte-kit/output/server');
const AS_JSON = process.argv.includes('--json');
const COMPARE = arg('--compare');
const TOP = Number(arg('--top') ?? 25);
/** A module of ogygia's own packages: its package, and its path inside it. */
const OGYGIA_RE = /^packages\/([^/]+)\/(.+)$/;
const SRC_OR_DIST_RE = /^(?:src|dist)\//;
const SCRIPT_EXT_RE = /\.[jt]s$/;

type Size = { raw: number; brotli: number };
type Report = {
	/** Every .js of the server output. */
	total: Size;
	/** What ogygia's packages wrote. */
	ogygia: Size;
	packages: Record<string, Size>;
	/** Each ogygia module's raw bytes, by `<package>/<path>`. */
	modules: Record<string, number>;
	/** Bytes no map gives to a module (a chunk's imports and exports, the bundler's glue). */
	unmapped: number;
};

const size = (text: string): Size => {
	const buf = Buffer.from(text);
	return { raw: buf.length, brotli: brotliCompressSync(buf).length };
};

if (!existsSync(join(APP, 'package.json'))) {
	console.error(`server-size: no app at ${APP}`);
	process.exit(1);
}
if (!process.argv.includes('--no-build')) {
	const vite = join(APP, 'node_modules/.bin/vite');
	const r = spawnSync(vite, ['build', '--sourcemap', 'hidden', '--logLevel', 'warn'], {
		cwd: APP,
		stdio: ['ignore', AS_JSON ? 'ignore' : 'inherit', 'inherit']
	});
	if (r.status !== 0) {
		console.error(`server-size: the build of ${relative(REPO, APP)} failed (exit ${r.status})`);
		process.exit(1);
	}
}

function js_files(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true, recursive: true })
		.filter((e) => e.isFile() && e.name.endsWith('.js'))
		.map((e) => join(e.parentPath, e.name))
		.sort();
}

function measure(): Report {
	const files = js_files(SERVER);
	if (files.length === 0) throw new Error(`server-size: no server output at ${SERVER}`);
	const all: string[] = [];
	const by_package = new Map<string, string[]>();
	const modules: Record<string, number> = {};
	let unmapped = 0;
	let maps = 0;
	for (const file of files) {
		const code = readFileSync(file, 'utf8');
		all.push(code);
		const map_file = `${file}.map`;
		// (a chunk that only re-exports another has no map: the bundler's glue, no module's)
		if (!existsSync(map_file)) {
			unmapped += Buffer.byteLength(code);
			continue;
		}
		maps++;
		const map = JSON.parse(readFileSync(map_file, 'utf8')) as {
			mappings: string;
			sources: Array<string | null>;
			sourceRoot?: string;
		};
		const texts = mapped_text(code, map);
		let mapped = 0;
		for (const [source, text] of texts) {
			const bytes = Buffer.byteLength(text);
			mapped += bytes;
			const path = relative(REPO, resolve(dirname(file), map.sourceRoot ?? '', source));
			const m = OGYGIA_RE.exec(path);
			if (m === null || path.includes('node_modules/')) continue;
			// (one name whether the package resolves to its source or its dist)
			const id = `${m[1]}/${m[2].replace(SRC_OR_DIST_RE, '').replace(SCRIPT_EXT_RE, '')}`;
			modules[id] = (modules[id] ?? 0) + bytes;
			let list = by_package.get(m[1]);
			if (list === undefined) by_package.set(m[1], (list = []));
			list.push(text);
		}
		unmapped += Buffer.byteLength(code) - mapped - (code.match(/\n/g)?.length ?? 0);
	}
	if (maps === 0)
		throw new Error(`server-size: no sourcemaps in ${SERVER} (build with --sourcemap hidden)`);
	const packages: Record<string, Size> = {};
	for (const [name, list] of [...by_package].sort(([a], [b]) => a.localeCompare(b)))
		packages[name] = size(list.join('\n'));
	return {
		total: size(all.join('\n')),
		ogygia: size([...by_package.values()].flat().join('\n')),
		packages,
		modules: Object.fromEntries(Object.entries(modules).sort(([, a], [, b]) => b - a)),
		unmapped
	};
}

/** THE SERVER'S LEAK GATE: the modules each feature's server code lives in. A server whose word
 *  (ogygia:server/runtime-flags, the browser's `HAS`) holds the feature holds every one of them; a
 *  server whose word lacks it holds none (packages/core/test/server-programs.test.ts holds what a
 *  server without them refuses). */
const SERVER_PROGRAMS: readonly { feature: string; bit: number; modules: readonly string[] }[] = [
	// the page seed: a streamed load's staging and its resolve stream, the seed's serializer
	{
		feature: 'page',
		bit: 0x2,
		modules: ['core/server/page-stream', 'core/server/page-seed', 'core/page-defer']
	},
	// the remote seed's gate (which remote queries ship)
	{ feature: 'remote-seeds', bit: 0x1, modules: ['core/server/remote-seed-gate'] },
	// the drop-in context root (an app reading context alone still holds the bridge's reader)
	{ feature: 'context', bit: 0x1000, modules: ['core/server/page-context'] },
	{
		feature: 'frames',
		bit: 0x10,
		modules: [
			'core/HoleRegion.svelte',
			'core/region-parts/hole-facts.svelte',
			'core/server/islands-endpoint',
			'core/server/stream-regions',
			'core/server/hole-graph',
			'core/server/hole-urls'
		]
	},
	{ feature: 'lakes', bit: 0x20, modules: ['core/LakeRegion.svelte'] },
	{
		feature: 'live',
		bit: 0x80,
		modules: ['core/region-parts/live-value.svelte', 'core/PromiseRegionAwait.svelte']
	}
];
/** The browser's own modules (an island entry's load and its recovery, the frame store, the
 *  `{@html}` range marks taken out before a hydrate): in no server build. */
const BROWSER_ONLY: readonly string[] = [
	'core/runtime/entry-locations',
	'core/runtime/import-again',
	'core/runtime/code-origins',
	'core/runtime/frame-store',
	'core/runtime/html-ranges'
];
const WORD_RE = /\b(?:var|const|let) HAS(?:\$\d+)? = (\d+);/;

/** The server's feature word, as its build wrote it. */
function server_word(): number | null {
	for (const file of js_files(SERVER)) {
		const m = WORD_RE.exec(readFileSync(file, 'utf8'));
		if (m) return Number(m[1]);
	}
	return null;
}

function leaks_of(r: Report, word: number): string[] {
	const out: string[] = [];
	for (const p of SERVER_PROGRAMS)
		for (const mod of p.modules) {
			const held = (word & p.bit) !== 0;
			if (held && !(mod in r.modules))
				out.push(`its word holds ${p.feature}, but the server lacks ${mod}`);
			else if (!held && mod in r.modules)
				out.push(`its word has no ${p.feature}, but the server holds ${mod}`);
		}
	for (const mod of BROWSER_ONLY)
		if (mod in r.modules) out.push(`the server holds ${mod}, a browser-only module`);
	return out;
}

const report = measure();
const word = server_word();
const leaks =
	word === null ? ['no server feature word found in the output (HAS = …)'] : leaks_of(report, word);
for (const leak of leaks) console.error(`server-size: ${relative(REPO, APP)}: ${leak}`);
if (AS_JSON) {
	console.log(JSON.stringify(report, null, 2));
	process.exit(leaks.length ? 1 : 0);
}

const base: Report | null = COMPARE ? (JSON.parse(readFileSync(COMPARE, 'utf8')) as Report) : null;
const n = (v: number) => v.toLocaleString('en-US');
const delta = (now: number, was: number | undefined) =>
	was === undefined ? '' : ` (${now - was >= 0 ? '+' : ''}${n(now - was)})`;
const row = (label: string, s: Size, was?: Size) =>
	console.log(
		`  ${label.padEnd(28)}${`${n(s.raw)}${delta(s.raw, was?.raw)}`.padStart(22)}${`${n(s.brotli)}${delta(s.brotli, was?.brotli)}`.padStart(20)}`
	);

console.log(`\nogygia in ${relative(REPO, APP)}'s server build (.svelte-kit/output/server)\n`);
console.log(`  ${''.padEnd(28)}${'raw'.padStart(22)}${'brotli'.padStart(20)}`);
row('server output, all', report.total, base?.total);
row('ogygia', report.ogygia, base?.ogygia);
for (const [name, s] of Object.entries(report.packages)) row(`  ${name}`, s, base?.packages[name]);
console.log(`\n  the ${TOP} largest ogygia modules (raw)`);
for (const [id, bytes] of Object.entries(report.modules).slice(0, TOP))
	console.log(
		`    ${id.padEnd(56)}${`${n(bytes)}${delta(bytes, base?.modules[id])}`.padStart(18)}`
	);
if (base) {
	const gone = Object.keys(base.modules).filter((id) => !(id in report.modules));
	if (gone.length) console.log(`\n  gone: ${gone.join(', ')}`);
}
console.log(
	`\n  server word ${word ?? '?'}: ${leaks.length ? `${leaks.length} leak(s)` : 'no leak'}`
);
console.log('');
if (leaks.length) process.exit(1);
