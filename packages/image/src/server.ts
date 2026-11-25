/**
 * The image server realm. `setup` hands `<Img>` the URL of each file:
 *
 * - on a live server and in dev, the build's static file for a warmed preset, the encoder's own link
 *   (`virtual:ogygia-image/namer`), or else a recipe's URL signed with the app's key in this plugin's
 *   own domain (`app.sign`: no expiry, so a recipe has one URL on every render, in every process, and
 *   a CDN keeps it forever);
 * - in Kit's prerender, every file is one the build makes: a static file under the app folder, named
 *   by its recipe alone, the same in every build with no key. Each recipe is noted on disk (the
 *   prerender runs in a worker) and its file started at once; the build's end writes every one and
 *   points the pages at them (./vite/build-files.ts). Until then the URL carries the build's mark, a
 *   host Kit's crawler does not follow: it would ask for a file not there yet under the app folder,
 *   which Kit answers 404 before any hook runs;
 * - in a page the build renders after its end wrote the files (an adapter's SPA fallback), the file
 *   the build wrote, with no mark (nothing would remove it), or the original where no prerendered
 *   page asked for that file.
 *
 * `request` is the endpoint that makes the signed files, in dev and on a live server: verify
 * (./verify.ts), then settle (./settle.ts). What the realm reads and notes on disk (./on-disk.ts) is
 * loaded in dev and in the build only.
 *
 * @packageDocumentation
 */
import { building, dev } from '$app/environment';
import { defineServer, type ServerPlugin } from '@ogygia/core/plugin';
import { cache } from '@ogygia/machine';
import config from 'virtual:ogygia-image/config';
import { name } from 'virtual:ogygia-image/namer';
import sources from 'virtual:ogygia-image/sources';
import { build_handoff, published, type BuildHandoff } from './handoff.ts';
import { warn } from './messages.ts';
import {
	built_file,
	built_url,
	encode_tail,
	IMAGE_PREFIX,
	parse_recipe,
	recipe_file,
	recipe_path,
	set_minter,
	source_tail,
	type ParsedRecipe,
	type Recipe
} from './recipe.ts';
import { message, verify } from './verify.ts';

type OnDisk = typeof import('./on-disk.ts');
const DISK: OnDisk | null = dev || building ? await import('./on-disk.ts') : null;

const { base: BASE, assets: ASSETS } = config.paths;
const PREFIXES: readonly string[] = [ASSETS, BASE];

/** The originals the endpoint may read: every image under `src/`, by the tail a recipe names. */
class Originals {
	#tails: ReadonlySet<string>;

	constructor(list: Readonly<Record<string, string>>) {
		this.#tails = Originals.#of(list);
	}

	static #of(list: Readonly<Record<string, string>>): ReadonlySet<string> {
		return new Set(Object.values(list).map((url) => source_tail(url, PREFIXES)));
	}

	/** Is `tail` one? In dev, also an image under `src/` added since the server started, by the
	 *  same rule the sources follow: the realm module is not run again for it. */
	has(tail: string): boolean {
		if (this.#tails.has(tail)) return true;
		const root = DEV_ROOT;
		return root !== null && DISK !== null && published(tail) && DISK.exists(root, tail);
	}
}

const DEV_ROOT: string | null = (dev && build_handoff()?.root) || null;
const ORIGINALS = new Originals(sources);

let said_no_encoder = false;
function no_encoder(e: unknown): Response {
	if (!said_no_encoder) warn('image_no_encoder', { reason: (e as Error).message });
	said_no_encoder = true;
	return new Response('this server cannot make images', {
		status: 500,
		headers: { 'cache-control': 'no-store' }
	});
}

function original_of(recipe: ParsedRecipe): string {
	return `${BASE}/${encode_tail(recipe.tail)}`;
}

const noted = new Set<string>();
let origin_unnoted: BuildHandoff | null = null;
const SIGNED_MAX = 10_000;

function root_relative(url: string): boolean {
	return url[0] === '/' && url[1] !== '/';
}

/** A prerendered page's URL of `recipe`: the build's file, noted (once) and started. */
function prerendered(disk: OnDisk, run: BuildHandoff, recipe: Recipe): string {
	const path = recipe_path(recipe, source_tail(recipe.src, PREFIXES));
	if (!noted.has(path)) {
		noted.add(path);
		disk.note_built(run.minted, path);
		const parsed = parse_recipe(path);
		if (parsed !== null && ORIGINALS.has(parsed.tail))
			// oxlint-disable-next-line ogygia/no-silent-failures -- a head start only: the build's end makes the file again and fails out loud
			void import('./settle.ts')
				.then((m) => m.prepare(parsed, recipe_file(parsed), original_of(parsed)))
				.catch(() => {});
	}
	const url = built_url(config.paths, recipe);
	return root_relative(url) ? run.mark + url : url;
}

const server: ServerPlugin<unknown> = defineServer<unknown>({
	setup(app) {
		const disk = DISK;
		const run = building && disk !== null ? build_handoff() : null;
		if (disk !== null && run?.written) {
			const written = run.written;
			set_minter((recipe) =>
				disk.exists(written, built_file(recipe)) ? built_url(config.paths, recipe) : recipe.src
			);
			return;
		}
		if (disk !== null && run?.minted) {
			origin_unnoted = run;
			set_minter((recipe) => prerendered(disk, run, recipe));
			return;
		}
		const signed = cache<string, string>({ name: 'image URLs', max: SIGNED_MAX });
		set_minter((recipe, built) => {
			if (built) return built_url(config.paths, recipe);
			const link = name(recipe);
			if (link !== null) return link;
			const path = recipe_path(recipe, source_tail(recipe.src, PREFIXES));
			let url = signed.get(path);
			if (url === undefined) {
				url = `${BASE}${IMAGE_PREFIX}${app.sign(message(path))}/${path}`;
				signed.set(path, url);
			}
			return url;
		});
	},

	async request({ event, app }) {
		const run = origin_unnoted;
		if (run && DISK !== null) {
			origin_unnoted = null;
			DISK.note_origin(run.minted, event.url.origin);
		}
		const at = BASE + IMAGE_PREFIX;
		const { pathname } = event.url;
		if (!pathname.startsWith(at)) return;
		const recipe = verify(
			app,
			event.request.method,
			event.url,
			pathname.slice(at.length),
			ORIGINALS
		);
		if (recipe instanceof Response) return recipe;
		let settle: typeof import('./settle.ts').settle;
		try {
			({ settle } = await import('./settle.ts'));
		} catch (e) {
			return no_encoder(e);
		}
		return settle(recipe, recipe_file(recipe), original_of(recipe));
	}
});
export default server;
