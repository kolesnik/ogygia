/**
 * SETTLE: one verified recipe → its file. The original is read (./reader.ts), made into the file by
 * the app's maker (`virtual:ogygia-image/maker`, ./maker.ts) and kept in the maker's store by the
 * recipe, so the next ask (this process, a restart, the next build) is a file read, streamed. A file
 * the store could not keep (no store, or a write that failed) is kept in memory instead, the least
 * recently asked going first. Loaded on the first image request only.
 *
 * Asks for one file share one make. A few makes run at once; on a live server a bounded line
 * waits behind them, for a bounded time, and an ask past it is answered 503 with a `retry-after`.
 * The build and the dev server queue every ask: their pages name each file once.
 *
 * @packageDocumentation
 */
import { clock, flights, queue, STALE, type Fresh, type Place } from '@ogygia/machine';
import { make, parallel, store } from 'virtual:ogygia-image/maker';
import { build_handoff } from './handoff.ts';
import { mime_of } from './layout.ts';
import { warn } from './messages.ts';
import { CannotMake } from './maker.ts';
import { Changed, read_original } from './reader.ts';
import type { ParsedRecipe } from './recipe.ts';

const MAX_WAITING = 64;
const WAIT_MS = 30_000;
const RETRY_AFTER_S = 5;
const MEMORY_MAX = 64 * 1024 * 1024;

const live = build_handoff() === null;

class Busy extends Error {}

type Job = { run: () => Promise<void>; gone: () => void };
const encodes = queue<Job>({
	name: 'image encodes',
	max: parallel,
	start: (job: Job, place: Place) => {
		// oxlint-disable-next-line ogygia/no-silent-failures -- run() settles its caller's promise with the failure and never rejects itself
		void job.run().finally(() => place.release());
	},
	stale: (job: Job) => job.gone()
});

let said_busy = false;
function limited<T>(work: () => Promise<T>): Promise<T> {
	if (live && encodes.waiting >= MAX_WAITING) {
		if (!said_busy) warn('image_busy', { waiting: encodes.waiting });
		said_busy = true;
		return Promise.reject(new Busy());
	}
	return new Promise<T>((resolve, reject) => {
		encodes.push(
			{ run: () => work().then(resolve, reject), gone: () => reject(new Busy()) },
			live ? clock.mono() + WAIT_MS : undefined
		);
	});
}

interface Made {
	data: Uint8Array;
	on_disk: boolean;
}

interface Ask {
	key: string;
	recipe: ParsedRecipe;
	original: string;
	platform: unknown;
}

const makes = flights.keyed<Ask>()<'key', 'recipe' | 'original' | 'platform', Promise<Made>>({
	name: 'image files',
	key: ['key'],
	ignore: {
		recipe: 'the key is the recipe',
		original: 'the key names the source by content, and a run checks the original against it',
		platform: "one process's requests carry the same bindings"
	},
	keep: (made: Fresh<Made>) => (made.on_disk ? 0 : Infinity),
	max: MEMORY_MAX,
	weigh: (made: Fresh<Made>) => made.data.byteLength,
	run: ({ key, recipe, original, platform }: Ask): Promise<Made> =>
		limited(async (): Promise<Made> => {
			const bytes = await read_original(original, recipe.id);
			const data = await make(bytes, recipe, platform);
			const on_disk = store !== null && (await store.keep(key, data));
			return { data, on_disk };
		})
});

/** Start making the file of `key` now (the prerender, as a page names it: the build's end finds it
 *  kept), unless it is kept. A failure is the build's end to report. */
export async function prepare(recipe: ParsedRecipe, key: string, original: string): Promise<void> {
	if (await store?.find(key)) return;
	await makes.get({ key, recipe, original, platform: undefined });
}

const KEEP = 'public, max-age=31536000, immutable';

/** The response for one verified recipe (`key` its file, ../recipe.ts `recipe_file`; `original` the
 *  asset URL Kit's `read()` takes; `platform` the request's `event.platform`). */
export async function settle(
	recipe: ParsedRecipe,
	key: string,
	original: string,
	platform?: unknown
): Promise<Response> {
	const type = mime_of(recipe.format);
	try {
		const kept = await store?.open(key);
		if (kept) {
			return new Response(kept.body, {
				headers: {
					'content-type': type,
					'content-length': String(kept.size),
					'cache-control': KEEP
				}
			});
		}
		const made = await makes.get({ key, recipe, original, platform });
		if (made === STALE) return failed(key, 'the encode was dropped before it finished');
		return new Response(new Uint8Array(made.data), {
			headers: {
				'content-type': type,
				'content-length': String(made.data.byteLength),
				'cache-control': KEEP
			}
		});
	} catch (e) {
		if (e instanceof Busy)
			return new Response('the image endpoint is busy', {
				status: 503,
				headers: { 'cache-control': 'no-store', 'retry-after': String(RETRY_AFTER_S) }
			});
		if (e instanceof CannotMake) return cannot_make(e);
		if (e instanceof Changed) {
			warn('image_source_changed', { path: key, tail: recipe.tail });
			return new Response('Not Found', { status: 404, headers: { 'cache-control': 'no-store' } });
		}
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

const said = new Set<string>();
function cannot_make(e: CannotMake): Response {
	if (!said.has(e.code)) warn(e.code, e.args);
	said.add(e.code);
	return new Response('this server cannot make images', {
		status: 500,
		headers: { 'cache-control': 'no-store' }
	});
}
