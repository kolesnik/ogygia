/**
 * THE BUILD'S FILES. Pages ask for image files and the endpoint makes them; during a build, two
 * kinds are made by the build itself, through one store (../store.ts, in the build cache, so a CI
 * run that keeps the cache makes nothing twice), side by side:
 *
 * - WARMED: `import.meta.og.image(src, { warm: 'cover' })` asks for the `cover` preset's files at
 *   build, for a page rendered on a live server. They are known once every module is read (the
 *   server build's end), and written into the client build as static files under
 *   `<appDir>/immutable/og/`, before Kit's prerender runs: `<Img preset="cover">` names them
 *   directly, on the server and in an island, and every host serves them as files kept forever.
 * - MINTED while prerendering: each URL a prerendered page names is noted on disk by the server realm
 *   (Kit's prerender runs in a worker, so not in this process's memory) and started at once. Kit's
 *   crawler saves the ones it asks for (`src`, `srcset`); when the prerender ends, every noted URL
 *   the crawler did not save (a `layOut()` CSS background, `prerender.crawl: false`) is written
 *   beside the prerendered pages, which every adapter copies out. One that cannot be made fails the
 *   build (`image_unsettled`).
 *
 * @packageDocumentation
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BuildCache } from '@ogygia/compiler';
import { clock, random } from '@ogygia/machine';
import type { AppPaths, RenderConfig } from '../config.ts';
import type { ImageDescriptor } from '../descriptor.ts';
import { lay_out, preset_request } from '../layout.ts';
import { OgygiaError } from '../messages.ts';
import { encode_recipe, VIPS_VERSION } from '../pixels.ts';
import { IMAGE_PREFIX, parse_recipe, warm_file, type Recipe } from '../recipe.ts';
import {
	build_handoff,
	BUILD_ENV,
	FileStore,
	open_build_store,
	type BuildHandoff
} from '../store.ts';

const PARALLEL = Math.max(1, Math.min(8, os.availableParallelism()));

const DAY_MS = 24 * 3600 * 1000;

/** Remove the run folders under `runs` a day old: a build that failed before its end leaves its
 *  own. A younger one may be a build running beside this one. */
function remove_old_runs(runs: string): void {
	const now = clock.wall();
	let names: string[];
	try {
		names = fs.readdirSync(runs);
		// oxlint-disable-next-line ogygia/no-silent-failures -- no runs folder yet: nothing was left
	} catch {
		return;
	}
	for (const name of names) {
		const run = path.join(runs, name);
		try {
			if (now - fs.statSync(run).mtimeMs > DAY_MS) fs.rmSync(run, { recursive: true, force: true });
			// oxlint-disable-next-line ogygia/no-silent-failures -- a run that could not be removed is tried again by the next build
		} catch {}
	}
}

/**
 * The handoff of this process's build or dev server, in the environment of the process and every
 * worker it starts: the store's folder and, for a build, the notes file of its prerender. A build
 * keeps the one it started until its end removes the notes' folder (Kit and its plugins resolve the
 * config more than once in one build); a dev server or a preview takes any there is, or starts one
 * with no notes.
 */
export function handoff_for(build: boolean): BuildHandoff {
	const open = build_handoff();
	if (open && (!build || (open.minted && fs.existsSync(path.dirname(open.minted))))) return open;
	const cache = new BuildCache('image').dir() ?? fs.mkdtempSync(path.join(os.tmpdir(), 'og-img-'));
	let minted = '';
	if (build) {
		remove_old_runs(path.join(cache, 'runs'));
		const run = path.join(cache, 'runs', random.uuid());
		fs.mkdirSync(run, { recursive: true });
		minted = path.join(run, 'minted.txt');
	}
	const handoff: BuildHandoff = {
		store: open_build_store(path.join(cache, 'files'), VIPS_VERSION),
		minted
	};
	process.env[BUILD_ENV] = JSON.stringify(handoff);
	return handoff;
}

/** One source a module warmed: its descriptor (no `src`: a warmed file is named by its recipe) and
 *  its original file. */
export interface WarmSource {
	file: string;
	desc: Omit<ImageDescriptor, 'src'>;
	presets: string[];
}

function warm_list(handoff: BuildHandoff): string {
	return path.join(path.dirname(handoff.minted), 'warm.json');
}

/** The server build's end: every warmed source, for the client build. */
export function save_warm(handoff: BuildHandoff, sources: Iterable<WarmSource>): void {
	fs.mkdirSync(path.dirname(handoff.minted), { recursive: true });
	fs.writeFileSync(warm_list(handoff), JSON.stringify([...sources]));
}

async function each<T>(items: readonly T[], work: (item: T) => Promise<void>): Promise<unknown[]> {
	const failures: unknown[] = [];
	let next = 0;
	const lane = async (): Promise<void> => {
		while (next < items.length) {
			const item = items[next++]!;
			try {
				await work(item);
			} catch (e) {
				failures.push(e);
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, lane));
	return failures;
}

async function made(
	store: FileStore,
	key: string,
	recipe: Omit<Recipe, 'id' | 'src'>,
	original: () => Uint8Array
): Promise<Uint8Array> {
	const kept = await store.find(key);
	if (kept) return fs.promises.readFile(kept.file);
	const data = await encode_recipe(original(), recipe);
	await store.keep(key, data);
	return data;
}

/** Every warmed file: `[fileName below the client output, bytes]`. */
export async function warm_files(
	handoff: BuildHandoff,
	cfg: RenderConfig
): Promise<Array<[string, Uint8Array]>> {
	let list: WarmSource[];
	try {
		list = JSON.parse(fs.readFileSync(warm_list(handoff), 'utf8')) as WarmSource[];
		// oxlint-disable-next-line ogygia/no-silent-failures -- no list: the server build warmed nothing
	} catch {
		return [];
	}
	const store = new FileStore(handoff.store);
	const jobs = new Map<string, { recipe: Recipe; file: string }>();
	for (const source of list)
		for (const name of source.presets) {
			const preset = cfg.presets[name];
			if (!preset) continue;
			lay_out({ ...source.desc, src: '' }, preset_request(preset), cfg, (recipe) => {
				jobs.set(warm_file(recipe), { recipe, file: source.file });
				return '';
			});
		}
	const out: Array<[string, Uint8Array]> = [];
	const failures = await each([...jobs], async ([name, { recipe, file }]) => {
		const data = await made(store, name, recipe, () => fs.readFileSync(file));
		out.push([`${cfg.paths.app_dir}/${name}`, data]);
	});
	if (failures.length)
		throw new OgygiaError('image_unsettled', {
			url: 'a warmed preset',
			reason: (failures[0] as Error).message
		});
	return out.sort((a, b) => (a[0] < b[0] ? -1 : 1));
}

/** The prerender's end: write every noted URL Kit's crawler did not save, into `pages` (Kit's
 *  prerendered pages folder), its original read from `output` (Kit's build output). */
export async function settle_minted(
	handoff: BuildHandoff,
	paths: AppPaths,
	output: string
): Promise<void> {
	let noted: string[] = [];
	try {
		noted = fs.readFileSync(handoff.minted, 'utf8').split('\n').filter(Boolean);
		// oxlint-disable-next-line ogygia/no-silent-failures -- no notes: nothing was prerendered
	} catch {}
	const pages = path.join(output, 'prerendered', 'pages');
	const store = new FileStore(handoff.store);
	const at = paths.base + IMAGE_PREFIX;
	const failures = await each([...new Set(noted)], async (url) => {
		const dest = path.join(
			pages,
			...url
				.slice(paths.base.length + 1)
				.split('/')
				.map(decodeURIComponent)
		);
		if (fs.existsSync(dest)) return;
		const rest = url.slice(at.length);
		const key = rest.slice(rest.indexOf('/') + 1);
		const recipe = parse_recipe(key);
		if (!url.startsWith(at) || recipe === null) throw new Error(`${url}: not an image URL`);
		const original = (): Uint8Array => {
			for (const side of ['client', 'server']) {
				const file = path.join(output, side, ...recipe.tail.split('/'));
				if (fs.existsSync(file)) return fs.readFileSync(file);
			}
			throw new Error(`its original ${recipe.tail} is not in the build output`);
		};
		try {
			const data = await made(store, key, recipe, original);
			await fs.promises.mkdir(path.dirname(dest), { recursive: true });
			await fs.promises.writeFile(dest, data);
		} catch (e) {
			throw new OgygiaError('image_unsettled', { url, reason: (e as Error).message });
		}
	});
	fs.rmSync(path.dirname(handoff.minted), { recursive: true, force: true });
	if (failures.length) throw failures[0];
}
