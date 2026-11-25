/**
 * THE BUILD'S FILES. Pages ask for image files and the endpoint makes them; the files a page served
 * with no server needs are made by the build itself, all in one place: the server build's end, after
 * Kit's prerender and before the adapter. Two kinds, one store (../store.ts, in the build cache, so a
 * CI run that keeps the cache makes nothing twice), one name (../recipe.ts `built_file`: the recipe,
 * whose id names its source by content, so the same file in every build with no key):
 *
 * - WARMED: `import.meta.og.image(src, { warm: 'cover' })` asks for the `cover` preset's files, for a
 *   page rendered on a live server. Every source the server build read with `warm` is listed.
 * - PRERENDERED: every file a prerendered page names. The server realm notes each recipe on disk
 *   (Kit's prerender runs in a worker) and starts it at once, and names it with the build's mark in
 *   front (Kit's crawler does not follow it: it would 404 a file under the app folder that is not
 *   there yet).
 *
 * Each file is written to the client output, under `<appDir>/immutable/og/`, which every adapter
 * serves as a file kept forever; then the mark is removed from every prerendered file, so its URLs
 * name those files. One that cannot be made fails the build (`image_unsettled`); a mark the page
 * changed before writing it does too (`image_mark_left`).
 *
 * @packageDocumentation
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { BuildCache } from '@ogygia/compiler';
import { clock, random } from '@ogygia/machine';
import type { RenderConfig } from '../config.ts';
import type { ImageDescriptor } from '../descriptor.ts';
import { lay_out, preset_request } from '../layout.ts';
import { OgygiaError } from '../messages.ts';
import { encode_recipe, VIPS_VERSION } from '../pixels.ts';
import { built_file, built_url, parse_recipe, recipe_file, type Recipe } from '../recipe.ts';
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
 * worker it starts: the store's folder and, for a build, the notes file of its prerender and its
 * mark (a random host: no page names it by chance). A build
 * keeps the one it started until its end removes the notes' folder (Kit and its plugins resolve the
 * config more than once in one build); a dev server or a preview takes any there is, or starts one
 * with no notes.
 */
export function handoff_for(build: boolean, root: string = process.cwd()): BuildHandoff {
	const open = build_handoff();
	if (open && (!build || (open.minted && fs.existsSync(path.dirname(open.minted))))) {
		if (open.root === root) return open;
		const rooted = { ...open, root };
		process.env[BUILD_ENV] = JSON.stringify(rooted);
		return rooted;
	}
	const cache = new BuildCache('image').dir() ?? fs.mkdtempSync(path.join(os.tmpdir(), 'og-img-'));
	let minted = '';
	let mark = '';
	if (build) {
		remove_old_runs(path.join(cache, 'runs'));
		const id = random.uuid();
		const run = path.join(cache, 'runs', id);
		fs.mkdirSync(run, { recursive: true });
		minted = path.join(run, 'minted.txt');
		mark = `//${id.replaceAll('-', '').slice(0, 16)}.ogygia.invalid`;
	}
	const handoff: BuildHandoff = {
		store: open_build_store(path.join(cache, 'files'), VIPS_VERSION),
		minted,
		mark,
		root
	};
	process.env[BUILD_ENV] = JSON.stringify(handoff);
	return handoff;
}

/** One source a module warmed: its descriptor (no `src`: a built file is named by its recipe), its
 *  original file and the presets it was warmed with. */
export interface WarmSource {
	file: string;
	desc: Omit<ImageDescriptor, 'src'>;
	presets: string[];
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

interface Job {
	recipe: Omit<Recipe, 'src'>;
	original: () => Uint8Array;
}

/** Every file the build makes, by its file below the app folder: each warmed preset's, and each
 *  recipe the prerender noted, its original read from `output` (Kit's build output). */
function jobs_of(
	handoff: BuildHandoff,
	cfg: RenderConfig,
	warmed: Iterable<WarmSource>,
	output: string
): Map<string, Job> {
	const jobs = new Map<string, Job>();
	for (const source of warmed)
		for (const name of source.presets) {
			const preset = cfg.presets[name];
			if (!preset) continue;
			lay_out({ ...source.desc, src: '' }, preset_request(preset), cfg, (recipe) => {
				jobs.set(built_file(recipe), { recipe, original: () => fs.readFileSync(source.file) });
				return '';
			});
		}
	let noted: string[] = [];
	try {
		noted = fs.readFileSync(handoff.minted, 'utf8').split('\n').filter(Boolean);
		// oxlint-disable-next-line ogygia/no-silent-failures -- no notes: nothing was prerendered
	} catch {}
	for (const line of noted) {
		const recipe = parse_recipe(line);
		if (recipe === null)
			throw new OgygiaError('image_unsettled', { url: line, reason: 'not an image recipe' });
		jobs.set(built_file(recipe), {
			recipe,
			original: () => {
				for (const side of ['client', 'server']) {
					const file = path.join(output, side, ...recipe.tail.split('/'));
					if (fs.existsSync(file)) return fs.readFileSync(file);
				}
				throw new Error(`its original ${recipe.tail} is not in the build output`);
			}
		});
	}
	return jobs;
}

function without(bytes: Buffer, cut: Buffer): Buffer {
	const parts: Buffer[] = [];
	let at = 0;
	for (let i = bytes.indexOf(cut); i !== -1; i = bytes.indexOf(cut, at)) {
		parts.push(bytes.subarray(at, i));
		at = i + cut.length;
	}
	parts.push(bytes.subarray(at));
	return Buffer.concat(parts);
}

/** Remove `mark` from every file under `dir` (Kit's prerendered pages and data). A mark read as a
 *  host (`https://<mark>…`: resolved against another URL) or left in another form (escaped, encoded)
 *  names no file: `image_mark_left`. */
function unmark(dir: string, mark: string): void {
	const cut = Buffer.from(mark);
	const label = Buffer.from(mark.slice(2));
	let names: string[];
	try {
		names = fs.readdirSync(dir, { recursive: true, encoding: 'utf8' });
		// oxlint-disable-next-line ogygia/no-silent-failures -- no prerendered folder: nothing was prerendered
	} catch {
		return;
	}
	for (const name of names) {
		const file = path.join(dir, name);
		if (!fs.statSync(file).isFile()) continue;
		const bytes = fs.readFileSync(file);
		if (bytes.indexOf(label) === -1) continue;
		for (let i = bytes.indexOf(cut); i !== -1; i = bytes.indexOf(cut, i + 1))
			if (bytes[i - 1] === 0x3a)
				throw new OgygiaError('image_mark_left', {
					file: name,
					form: 'resolved it against another URL (`new URL(src, origin)`)'
				});
		const out = without(bytes, cut);
		if (out.indexOf(label) !== -1)
			throw new OgygiaError('image_mark_left', { file: name, form: 'escaped or encoded it' });
		fs.writeFileSync(file, out);
	}
}

/** The server build's end: write every file the build makes (`warmed`, and the prerender's notes)
 *  under `<output>/client/<appDir>/`, then point every prerendered page at them. `output` is Kit's
 *  build output. */
export async function write_built(
	handoff: BuildHandoff,
	cfg: RenderConfig,
	warmed: Iterable<WarmSource>,
	output: string
): Promise<void> {
	const jobs = jobs_of(handoff, cfg, warmed, output);
	const store = new FileStore(handoff.store);
	const client = path.join(output, 'client', cfg.paths.app_dir);
	const failures = await each([...jobs], async ([name, { recipe, original }]) => {
		try {
			const data = await made(store, recipe_file(recipe), recipe, original);
			const dest = path.join(client, ...name.split('/'));
			await fs.promises.mkdir(path.dirname(dest), { recursive: true });
			await fs.promises.writeFile(dest, data);
		} catch (e) {
			throw new OgygiaError('image_unsettled', {
				url: built_url(cfg.paths, recipe),
				reason: (e as Error).message
			});
		}
	});
	fs.rmSync(path.dirname(handoff.minted), { recursive: true, force: true });
	if (failures.length) throw failures[0];
	if (handoff.mark) unmark(path.join(output, 'prerendered'), handoff.mark);
}
