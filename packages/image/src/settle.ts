/**
 * SETTLE: one signed recipe → its file. The original is read with Kit's `read()` (the image server
 * realm imports every image under `src/`, so each is one of the server's assets in dev, in the
 * prerender and on any adapter), encoded once, and kept in the file store (./store.ts) by the recipe,
 * so the next ask (this process, a restart, the next build) is a file read, streamed. Loaded on the
 * first image request only: a server that never serves one never loads sharp.
 *
 * @packageDocumentation
 */
import fs from 'node:fs';
import os from 'node:os';
import { Readable } from 'node:stream';
import { read } from '$app/server';
import { flights, queue, STALE, type Place } from '@ogygia/machine';
import { mime_of } from './layout.ts';
import { warn } from './messages.ts';
import { encode_recipe, VIPS_VERSION } from './pixels.ts';
import type { ParsedRecipe } from './recipe.ts';
import { build_handoff, FileStore, runtime_store } from './store.ts';

const MAX_ENCODES = Math.max(1, Math.min(4, Math.floor(os.availableParallelism() / 2)));

const handoff = build_handoff();
const store: FileStore | null = handoff
	? new FileStore(handoff.store)
	: runtime_store(VIPS_VERSION);

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

const makes = flights.keyed<{ key: string; recipe: ParsedRecipe; original: string }>()({
	key: ['key'],
	ignore: {
		recipe: 'the key is the recipe path',
		original: 'the recipe path names the original'
	},
	keep: 0,
	run: ({ key, recipe, original }) =>
		limited(async () => {
			const bytes = new Uint8Array(await read(original).arrayBuffer());
			const data = await encode_recipe(bytes, recipe);
			await store?.keep(key, data);
			return data;
		})
});

/** Start making the file of `key` now (the prerender, as a page names it: the crawler's ask joins
 *  it), unless it is kept. A failure is the ask's to report. */
export async function prepare(recipe: ParsedRecipe, key: string, original: string): Promise<void> {
	if (await store?.find(key)) return;
	await makes.get({ key, recipe, original });
}

const KEEP = 'public, max-age=31536000, immutable';

/** The response for one verified recipe (`key` is its path, `original` the asset URL Kit's `read()`
 *  takes). */
export async function settle(
	recipe: ParsedRecipe,
	key: string,
	original: string
): Promise<Response> {
	const type = mime_of(recipe.format);
	try {
		const kept = await store?.find(key);
		if (kept) {
			const body = Readable.toWeb(fs.createReadStream(kept.file)) as ReadableStream<Uint8Array>;
			return new Response(body, {
				headers: {
					'content-type': type,
					'content-length': String(kept.size),
					'cache-control': KEEP
				}
			});
		}
		const made = await makes.get({ key, recipe, original });
		if (made === STALE) return failed(key, 'the encode was dropped before it finished');
		return new Response(new Uint8Array(made), {
			headers: {
				'content-type': type,
				'content-length': String(made.byteLength),
				'cache-control': KEEP
			}
		});
	} catch (e) {
		return failed(key, (e as Error).message);
	}
}

function failed(key: string, reason: string): Response {
	warn('image_settle_failed', { path: key, reason });
	return new Response('image could not be made', {
		status: 500,
		headers: { 'cache-control': 'no-store' }
	});
}
