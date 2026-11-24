/**
 * The FILE STORE: every file made from a recipe, kept on disk by its key (the recipe's unsigned path,
 * which names its source by content), so the next ask is a file read. One store per place it runs:
 *
 * - the build and the dev server (the plugin hands its process the build cache's folder,
 *   `node_modules/.ogygia/image-files`): a warm build or a CI run with the cache kept encodes nothing
 *   it made before, and Kit's prerender, which runs in a worker of the same process, reads the same
 *   folder;
 * - a live server: a folder under the system's temporary folder that only this user owns, one per
 *   encoder version (the other versions are removed), files older than a month removed at start.
 *
 * Server and build only (Node).
 *
 * @packageDocumentation
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clock, random } from '@ogygia/machine';
import { warn } from './messages.ts';
import { ENCODER_VERSION, VIPS_VERSION } from './pixels.ts';

/** What the plugin hands the processes of one `vite build` or dev server (and Kit's prerender
 *  worker, which inherits the environment): the store's folder, and the file the build's mints are
 *  noted in. Internal: the plugin writes it, nothing else should. */
export const BUILD_ENV = '__OGYGIA_IMAGE_BUILD';

/** The build's handoff, when this process runs under the plugin. */
export interface BuildHandoff {
	/** The store's folder. */
	store: string;
	/** The file every URL minted while prerendering is noted in, one per line. */
	minted: string;
}

/** The handoff the plugin left in the environment, or null on a live server. */
export function build_handoff(): BuildHandoff | null {
	const raw = typeof process === 'undefined' ? undefined : process.env[BUILD_ENV];
	if (!raw) return null;
	const v = JSON.parse(raw) as Partial<BuildHandoff>;
	if (typeof v.store !== 'string' || typeof v.minted !== 'string') return null;
	return { store: v.store, minted: v.minted };
}

const VERSION_DIR = `v${ENCODER_VERSION}-${VIPS_VERSION}`;
const MONTH_MS = 30 * 24 * 3600 * 1000;

/** Files made from recipes, by key, in one folder. */
export class FileStore {
	readonly dir: string;

	constructor(dir: string) {
		this.dir = dir;
	}

	/** Where the file of `key` is kept. */
	file(key: string): string {
		const h = crypto.createHash('sha256').update(key).digest('base64url').slice(0, 32);
		return path.join(this.dir, h.slice(0, 2), h);
	}

	/** The file of `key`, when it is made: its path and size. */
	async find(key: string): Promise<{ file: string; size: number } | null> {
		const file = this.file(key);
		try {
			const stat = await fs.promises.stat(file);
			return stat.isFile() ? { file, size: stat.size } : null;
			// oxlint-disable-next-line ogygia/no-silent-failures -- no file is a miss: the caller makes it
		} catch {
			return null;
		}
	}

	/** Keep `data` as the file of `key` (written whole, then moved in: a reader never sees half). */
	async keep(key: string, data: Uint8Array): Promise<void> {
		const file = this.file(key);
		await fs.promises.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
		const tmp = `${file}.${process.pid}.${random.uuid()}.tmp`;
		await fs.promises.writeFile(tmp, data, { mode: 0o600 });
		await fs.promises.rename(tmp, file);
	}
}

/** The build cache's store folder under `cache` (the plugin's `BuildCache` folder). */
export function build_store_dir(cache: string): string {
	return path.join(cache, VERSION_DIR);
}

/** Is `dir` a real folder (not a link) that only this user can read and write? */
function owned(dir: string): boolean {
	const stat = fs.lstatSync(dir);
	if (!stat.isDirectory() || stat.isSymbolicLink()) return false;
	if (typeof process.getuid !== 'function') return true;
	return stat.uid === process.getuid() && (stat.mode & 0o077) === 0;
}

/** A live server's store: `<tmp>/ogygia-image-<uid>/<version>/`, made owner-only. Null (no store:
 *  each file is made per ask, flights still share one) when the folder is not safely this user's: a
 *  folder another user made first, or a link, could hand out bytes it chose. */
export function runtime_store(tmp: string = os.tmpdir()): FileStore | null {
	const uid = typeof process.getuid === 'function' ? process.getuid() : 'user';
	const root = path.join(tmp, `ogygia-image-${uid}`);
	try {
		fs.mkdirSync(root, { mode: 0o700 });
		// oxlint-disable-next-line ogygia/no-silent-failures -- an existing folder is checked below
	} catch {}
	try {
		if (!owned(root)) {
			warn('image_store_unsafe', { dir: root });
			return null;
		}
		const dir = path.join(root, VERSION_DIR);
		fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
		if (!owned(dir)) {
			warn('image_store_unsafe', { dir });
			return null;
		}
		// oxlint-disable-next-line ogygia/no-silent-failures -- prune() catches its own failures: what it could not remove stays until the next start
		void prune(root, dir);
		return new FileStore(dir);
	} catch (e) {
		warn('image_store_unsafe', { dir: `${root} (${(e as Error).message})` });
		return null;
	}
}

/** Remove the other encoder versions' folders under `root`, and files in `dir` older than a month. */
async function prune(root: string, dir: string): Promise<void> {
	const now = clock.wall();
	try {
		for (const name of await fs.promises.readdir(root))
			if (path.join(root, name) !== dir)
				await fs.promises.rm(path.join(root, name), { recursive: true, force: true });
		for (const shard of await fs.promises.readdir(dir)) {
			const at = path.join(dir, shard);
			for (const name of await fs.promises.readdir(at)) {
				const file = path.join(at, name);
				const stat = await fs.promises.stat(file);
				if (now - stat.mtimeMs > MONTH_MS) await fs.promises.rm(file, { force: true });
			}
		}
		// oxlint-disable-next-line ogygia/no-silent-failures -- a prune is housekeeping: what it could not remove stays until the next start tries again
	} catch {}
}
