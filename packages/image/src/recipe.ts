/**
 * A recipe: one file a page asks for, made from one source. Its whole description rides in the URL
 * PATH (a prerendered page's files are saved at their paths, and a static host has no query), signed
 * by the server, so the endpoint that makes it needs nothing but the URL: any server instance, the
 * prerender, a CDN in front. Isomorphic: `<Img>` builds recipes on the server and in the browser; only
 * the server can sign one.
 *
 *   <base>/__ogygia__/i/<sig>/<id>-<w>x<h>[-q<q>][-p<position>][-o<ops>]/<original path>.<ext>
 *
 * A file the build made ahead (a warmed preset's) is a static file instead, named by its head alone:
 *
 *   <assets or base>/<appDir>/immutable/og/<id>-<w>x<h>[-q<q>][-p<position>][-o<ops>].<ext>
 *
 * @packageDocumentation
 */
import { slot } from '@ogygia/machine';
import type { AppPaths } from './config.ts';
import type { ImageFormat, ImageOps } from './descriptor.ts';

/** One file to make. */
export interface Recipe {
	/** The source's id. */
	id: string;
	/** The source's original file, as its descriptor names it. */
	src: string;
	width: number;
	height: number;
	format: ImageFormat;
	quality?: number;
	/** Where a crop keeps, when the box's shape is not the source's. */
	position?: string;
	ops?: ImageOps;
}

/** The URL path every recipe sits under, after the app's base. */
export const IMAGE_PREFIX = '/__ogygia__/i/';

/** Where the build's own files sit, under the app's `appDir`: Kit's immutable folder, which every
 *  adapter and static host serves as files kept forever. */
export const WARM_DIR = 'immutable/og';

const EXT: Readonly<Record<ImageFormat, string>> = {
	avif: 'avif',
	webp: 'webp',
	png: 'png',
	jpeg: 'jpg',
	gif: 'gif',
	svg: 'svg',
	tiff: 'tif'
};
const FORMAT_OF_EXT: ReadonlyMap<string, ImageFormat> = new Map([
	['avif', 'avif'],
	['webp', 'webp'],
	['png', 'png'],
	['jpg', 'jpeg']
]);
const POSITIONS: ReadonlySet<string> = new Set([
	'centre',
	'center',
	'top',
	'bottom',
	'left',
	'right',
	'attention',
	'entropy'
]);
const HEAD_RE =
	/^([A-Za-z0-9_-]{1,64})-(\d{1,5})x(\d{1,5})(?:-q(\d{1,3}))?(?:-p([a-z]+))?(?:-o([A-Za-z0-9_-]+))?$/;
const TAIL_RE = /^(?!.*(?:^|\/)\.{1,2}(?:\/|$))[^\\\0]+$/;

function b64url_encode(text: string): string {
	const bytes = new TextEncoder().encode(text);
	let bin = '';
	for (const b of bytes) bin += String.fromCharCode(b);
	return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64url_decode(text: string): string {
	const bin = atob(text.replace(/-/g, '+').replace(/_/g, '/'));
	return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

/** The original's path as a recipe carries it, decoded: the asset URL without its origin, base,
 *  query or leading slash. `prefixes` are the app's asset and base paths (`https://cdn.example.com`,
 *  `/shop`). */
export function source_tail(src: string, prefixes: readonly string[]): string {
	let s = src.split(/[?#]/)[0]!;
	for (const p of prefixes)
		if (p && s.startsWith(`${p}/`)) {
			s = s.slice(p.length);
			break;
		}
	s = s.replace(/^\/+/, '');
	try {
		return decodeURI(s);
		// oxlint-disable-next-line ogygia/no-silent-failures -- a path that is not an escaped URL is already the file's own name
	} catch {
		return s;
	}
}

/** A decoded tail as URL path segments. */
export function encode_tail(tail: string): string {
	return tail.split('/').map(encodeURIComponent).join('/');
}

function decode_tail(raw: string): string | null {
	try {
		return raw.split('/').map(decodeURIComponent).join('/');
		// oxlint-disable-next-line ogygia/no-silent-failures -- a path that does not decode names no original: the endpoint answers 404
	} catch {
		return null;
	}
}

/** The recipe's path below {@link IMAGE_PREFIX} and its signature: `<id>-<w>x<h>…/<tail>.<ext>`,
 *  `tail` (decoded) written as escaped path segments. */
export function recipe_path(r: Recipe, tail: string): string {
	return `${recipe_head(r)}/${encode_tail(tail)}.${EXT[r.format]}`;
}

/** What a recipe asks of its source, with no file name: `<id>-<w>x<h>[-q…][-p…][-o…]`. */
export function recipe_head(r: Omit<Recipe, 'src'>): string {
	const q = r.quality === undefined ? '' : `-q${r.quality}`;
	const p = r.position === undefined ? '' : `-p${r.position}`;
	const o =
		r.ops === undefined || !Object.keys(r.ops).length
			? ''
			: `-o${b64url_encode(JSON.stringify(r.ops))}`;
	return `${r.id}-${r.width}x${r.height}${q}${p}${o}`;
}

/** A warmed recipe's file, below the app's `appDir`: `immutable/og/<head>.<ext>`. */
export function warm_file(r: Omit<Recipe, 'src'>): string {
	return `${WARM_DIR}/${recipe_head(r)}.${EXT[r.format]}`;
}

/** A warmed recipe's URL: the static file the build made. */
export function warm_url(paths: AppPaths, r: Omit<Recipe, 'src'>): string {
	return `${paths.assets || paths.base}/${paths.app_dir}/${warm_file(r)}`;
}

/** What a recipe path asks for. The original is named by its tail (decoded). */
export interface ParsedRecipe {
	id: string;
	tail: string;
	width: number;
	height: number;
	format: ImageFormat;
	quality?: number;
	position?: string;
	ops?: ImageOps;
}

/** Read a recipe path (`<id>-<w>x<h>…/<tail>.<ext>`), strictly: anything else is null. */
export function parse_recipe(path: string): ParsedRecipe | null {
	const slash = path.indexOf('/');
	if (slash === -1) return null;
	const head = HEAD_RE.exec(path.slice(0, slash));
	const rest = path.slice(slash + 1);
	const dot = rest.lastIndexOf('.');
	if (!head || dot === -1) return null;
	const format = FORMAT_OF_EXT.get(rest.slice(dot + 1));
	const tail = decode_tail(rest.slice(0, dot));
	if (!format || tail === null || !TAIL_RE.test(tail)) return null;
	const width = Number(head[2]);
	const height = Number(head[3]);
	if (width < 1 || height < 1) return null;
	const out: ParsedRecipe = { id: head[1]!, tail, width, height, format };
	if (head[4] !== undefined) {
		const q = Number(head[4]);
		if (q < 1 || q > 100) return null;
		out.quality = q;
	}
	if (head[5] !== undefined) {
		if (!POSITIONS.has(head[5])) return null;
		out.position = head[5];
	}
	if (head[6] !== undefined) {
		try {
			const ops = JSON.parse(b64url_decode(head[6])) as unknown;
			if (ops === null || typeof ops !== 'object' || Array.isArray(ops)) return null;
			out.ops = ops as ImageOps;
			// oxlint-disable-next-line ogygia/no-silent-failures -- ops that do not decode make the path no recipe: the endpoint answers 404
		} catch {
			return null;
		}
	}
	return out;
}

/** What the server realm hands `<Img>`: a signed URL for a recipe. */
export type Minter = (recipe: Recipe) => string;

const minting = slot<{ mint: Minter | null }>({
	name: 'ogygia.image.minter',
	version: 1,
	make: () => ({ mint: null })
});

/** Set (or clear) the process's minter: the image server realm's `setup`. */
export function set_minter(mint: Minter | null): void {
	minting.mint = mint;
}

/** The signed URL of `recipe`, or null where nothing can sign (the browser). */
export function mint(recipe: Recipe): string | null {
	return minting.mint ? minting.mint(recipe) : null;
}
