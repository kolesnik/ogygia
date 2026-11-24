/**
 * SETTLE: one signed recipe → its file. The original is read with Kit's `read()` (the image server
 * realm imports every image under `src/`, so each is one of the server's assets in dev, in the
 * prerender and on any adapter), encoded once, and kept on disk by the recipe, so the next ask (this
 * process, a restart) is a file read. Loaded on the first image request only: a server that never
 * serves one never loads sharp.
 *
 * @packageDocumentation
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { read } from '$app/server';
import { flights, queue, random, STALE, type Place } from '@ogygia/machine';
import { mime_of } from './layout.ts';
import { warn } from './messages.ts';
import { encode, ENCODER_VERSION, metadata_of, VIPS_VERSION } from './pixels.ts';
import type { ParsedRecipe } from './recipe.ts';

const CACHE_DIR = path.join(os.tmpdir(), 'ogygia-image', String(ENCODER_VERSION));
const MAX_ENCODES = Math.max(2, Math.min(8, Math.floor(os.availableParallelism() / 2)));

type Job = { run: () => Promise<void> };
const encodes = queue<Job>({
	name: 'image encodes',
	max: MAX_ENCODES,
	start: (job: Job, place: Place) => {
		// oxlint-disable-next-line ogygia/no-silent-failures -- run() settles its caller's promise with the failure and never rejects itself
		void job.run().finally(() => place.release());
	}
});

function limited<T>(work: () => Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		encodes.push({ run: () => work().then(resolve, reject) });
	});
}

/** Where the file of `recipe_path` is kept. */
export function cached_file(recipe_path: string): string {
	const key = crypto
		.createHash('sha256')
		.update(`${recipe_path}\0${VIPS_VERSION}`)
		.digest('base64url')
		.slice(0, 32);
	return path.join(CACHE_DIR, key.slice(0, 2), key);
}

const makes = flights.keyed<{ out: string; recipe: ParsedRecipe; original: string }>()({
	key: ['out'],
	ignore: {
		recipe: 'the out path is a hash of the recipe path',
		original: 'the recipe path names the original'
	},
	keep: 0,
	run: ({ out, recipe, original }) =>
		limited(async () => {
			if (fs.existsSync(out)) return fs.readFileSync(out);
			const bytes = new Uint8Array(await read(original).arrayBuffer());
			const meta = await metadata_of(bytes);
			const data = await encode(bytes, recipe, (meta.pages ?? 1) > 1);
			fs.mkdirSync(path.dirname(out), { recursive: true });
			const tmp = `${out}.${process.pid}.${random.uuid()}.tmp`;
			fs.writeFileSync(tmp, data);
			fs.renameSync(tmp, out);
			return data;
		})
});

/** The response for one verified recipe (`recipe_path` is its path, `original` the asset URL Kit's
 *  `read()` takes). */
export async function settle(
	recipe: ParsedRecipe,
	recipe_path: string,
	original: string
): Promise<Response> {
	const out = cached_file(recipe_path);
	let data: Buffer;
	try {
		const made = fs.existsSync(out)
			? fs.readFileSync(out)
			: await makes.get({ out, recipe, original });
		if (made === STALE) return failed(recipe_path, 'the encode was dropped before it finished');
		data = made;
	} catch (e) {
		return failed(recipe_path, (e as Error).message);
	}
	return new Response(new Uint8Array(data), {
		headers: {
			'content-type': mime_of(recipe.format),
			'content-length': String(data.byteLength),
			'cache-control': 'public, max-age=31536000, immutable'
		}
	});
}

function failed(recipe_path: string, reason: string): Response {
	warn('image_settle_failed', { path: recipe_path, reason });
	return new Response('image could not be made', { status: 500 });
}
