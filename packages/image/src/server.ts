/**
 * The image plugin's server realm. `setup` hands `<Img>` a minter: each recipe's URL, signed with
 * the app's key in this plugin's own domain (`app.sign`: no expiry, so a recipe has one URL on every
 * render, in every process, and a CDN or a static host keeps it forever). `request` is the endpoint
 * that makes the files: in dev, in Kit's prerender (whose crawler asks for every `src` / `srcset` a
 * page names, and saves each answer as a file) and on a live server alike.
 *
 * While prerendering, each URL minted is also noted on disk and its file started at once (the
 * crawler asks one at a time; the encodes run side by side): the build writes every noted file the
 * crawler did not ask for (a `layOut()` CSS background, `prerender.crawl` off) once the prerender
 * ends (./vite/build-files.ts).
 *
 * @packageDocumentation
 */
import fs from 'node:fs';
import { building } from '$app/environment';
import { defineServer, type ServerApp, type ServerPlugin } from '@ogygia/core/plugin';
import config from 'virtual:ogygia-image/config';
import sources from 'virtual:ogygia-image/sources';
import { warn } from './messages.ts';
import {
	encode_tail,
	IMAGE_PREFIX,
	parse_recipe,
	recipe_path,
	set_minter,
	source_tail,
	type ParsedRecipe
} from './recipe.ts';
import { build_handoff } from './store.ts';

const { base: BASE, assets: ASSETS } = config.paths;
const PREFIXES: readonly string[] = [ASSETS, BASE];

const ORIGINALS: ReadonlySet<string> = new Set(
	Object.values(sources).map((url) => source_tail(url, PREFIXES))
);

function message(path: string): string {
	return `image|${path}`;
}

function refused(status: 403 | 404, app: ServerApp<unknown>): Response {
	if (status === 404)
		return new Response('Not Found', { status, headers: { 'cache-control': 'no-store' } });
	return new Response('Forbidden', {
		status,
		headers: {
			'cache-control': 'no-store',
			'x-ogygia-deny': 'sig',
			'x-ogygia-key': app.keyFingerprint()
		}
	});
}

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

function note_minted(url: string, path: string, minted: string): void {
	if (noted.has(url)) return;
	noted.add(url);
	fs.appendFileSync(minted, `${url}\n`);
	const recipe = parse_recipe(path);
	if (recipe === null || !ORIGINALS.has(recipe.tail)) return;
	// oxlint-disable-next-line ogygia/no-silent-failures -- a head start only: the crawler's ask, or the build's end, makes the file again and fails out loud
	void import('./settle.ts')
		.then((m) => m.prepare(recipe, path, original_of(recipe)))
		.catch(() => {});
}

const server: ServerPlugin<unknown> = defineServer<unknown>({
	setup(app) {
		const minted = (building && build_handoff()?.minted) || null;
		set_minter((recipe) => {
			const path = recipe_path(recipe, source_tail(recipe.src, PREFIXES));
			const url = `${BASE}${IMAGE_PREFIX}${app.sign(message(path))}/${path}`;
			if (minted !== null) note_minted(url, path, minted);
			return url;
		});
	},

	async request({ event, app }) {
		const at = BASE + IMAGE_PREFIX;
		const { pathname } = event.url;
		if (!pathname.startsWith(at)) return;
		const rest = pathname.slice(at.length);
		const slash = rest.indexOf('/');
		const sig = rest.slice(0, slash);
		const path = rest.slice(slash + 1);
		if (slash < 1 || !app.verify(message(path), sig)) return refused(403, app);
		const recipe = parse_recipe(path);
		if (recipe === null || !ORIGINALS.has(recipe.tail)) return refused(404, app);
		if (event.url.search !== '')
			return new Response(null, {
				status: 308,
				headers: { location: pathname, 'cache-control': 'public, max-age=31536000, immutable' }
			});
		let settle: typeof import('./settle.ts').settle;
		try {
			({ settle } = await import('./settle.ts'));
		} catch (e) {
			return no_encoder(e);
		}
		return settle(recipe, path, original_of(recipe));
	}
});
export default server;
