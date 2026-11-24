/**
 * The image plugin's server realm. `setup` hands `<Img>` a minter: each recipe's URL, signed with
 * the app's key in this plugin's own domain (`app.sign`: no expiry, so a recipe has one URL on every
 * render, in every process, and a CDN or a static host keeps it forever). `request` is the endpoint
 * that makes the files: in dev, in Kit's prerender (whose crawler asks for every `src` / `srcset` a
 * page names, and saves each answer as a file) and on a live server alike.
 *
 * @packageDocumentation
 */
import { defineServer, type ServerApp, type ServerPlugin } from '@ogygia/core/plugin';
import sources from 'virtual:ogygia-image/sources';
import {
	encode_tail,
	IMAGE_PREFIX,
	parse_recipe,
	recipe_path,
	set_minter,
	source_tail
} from './recipe.ts';

declare const __SVELTEKIT_PATHS_BASE__: string;
declare const __SVELTEKIT_PATHS_ASSETS__: string;

const BASE: string =
	typeof __SVELTEKIT_PATHS_BASE__ !== 'undefined' ? __SVELTEKIT_PATHS_BASE__ : '';
const ASSETS: string =
	typeof __SVELTEKIT_PATHS_ASSETS__ !== 'undefined' ? __SVELTEKIT_PATHS_ASSETS__ : '';
const PREFIXES: readonly string[] = [ASSETS, BASE];
const SIG_LENGTH = 32;
const SIG_RE = /^[0-9a-f]{32}$/;

const ORIGINALS: ReadonlySet<string> = new Set(
	Object.values(sources).map((url) => source_tail(url, PREFIXES))
);

function signature(app: ServerApp<unknown>, path: string): string {
	return app.sign(`image|${path}`).slice(0, SIG_LENGTH);
}

function same(a: string, b: string): boolean {
	if (a.length !== b.length) return false;
	let diff = 0;
	for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
	return diff === 0;
}

function refused(status: 403 | 404): Response {
	return new Response(status === 403 ? 'Forbidden' : 'Not Found', {
		status,
		headers: { 'cache-control': 'no-store' }
	});
}

const server: ServerPlugin<unknown> = defineServer<unknown>({
	setup(app) {
		set_minter((recipe) => {
			const path = recipe_path(recipe, source_tail(recipe.src, PREFIXES));
			return `${BASE}${IMAGE_PREFIX}${signature(app, path)}/${path}`;
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
		if (slash === -1 || !SIG_RE.test(sig) || !same(sig, signature(app, path))) return refused(403);
		const recipe = parse_recipe(path);
		if (recipe === null || !ORIGINALS.has(recipe.tail)) return refused(404);
		const { settle } = await import('./settle.ts');
		return settle(recipe, path, `${BASE}/${encode_tail(recipe.tail)}`);
	}
});
export default server;
