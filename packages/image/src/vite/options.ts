/**
 * The options: the plugin's defaults (`image({ … })`) and one image's own (`import.meta.og.image(src,
 * { … })`). Both are plain JSON, checked here, so a typo fails the build instead of being ignored.
 *
 * @packageDocumentation
 */
import { OgygiaError } from '../messages.ts';

/** A format the encoder writes. */
export type OutputFormat = 'avif' | 'webp' | 'png' | 'jpeg';

/** Pixel operations, applied before resizing, in this order. Each is sharp's operation of that name. */
export interface ImageOps {
	/** Crop to this aspect ratio (`16 / 9`, or `'16/9'`) around `position`. */
	aspect?: number | string;
	/** Where a crop keeps: `'center'` (default), `'top'`, `'bottom'`, `'left'`, `'right'`, or
	 *  `'attention'` / `'entropy'` (sharp's smart crops). */
	position?: string;
	rotate?: number;
	flip?: boolean;
	flop?: boolean;
	grayscale?: boolean;
	blur?: number;
	sharpen?: boolean;
	normalize?: boolean;
	negate?: boolean;
	gamma?: number;
	tint?: string;
	modulate?: { brightness?: number; saturation?: number; hue?: number; lightness?: number };
}

/** One image's options. */
export interface ImageOptions {
	/** Encoder quality, 1–100. Default: 60 for AVIF, 80 for the others. */
	quality?: number;
	/** The formats to write, best first. Default `['avif', 'webp']`. An animated image is written as
	 *  animated WebP whatever this says. */
	formats?: OutputFormat[];
	/** The widest this image is ever shown, in CSS pixels: the encoder writes widths up to twice it
	 *  (for 2× screens) instead of the whole ladder. */
	width?: number;
	/** Paint a blur placeholder until the image arrives. Default `true` (never for a transparent
	 *  image or an SVG). */
	placeholder?: boolean;
	/** Pixel operations. */
	ops?: ImageOps;
}

/** The plugin's options: every image's defaults, and markdown's. */
export interface ImagePluginOptions {
	quality?: number;
	formats?: OutputFormat[];
	placeholder?: boolean;
	/** The width ladder a responsive image is written at (capped at the image's own width). Default
	 *  `[320, 480, 640, 960, 1280, 1600, 2048]`. */
	breakpoints?: number[];
	/** Markdown images (with `@ogygia/content`): `width` is the prose column's width, in CSS pixels;
	 *  `false` leaves markdown images as plain `<img>`. Default `{}` (each image as wide as itself). */
	markdown?: { width?: number } | false;
}

export const DEFAULT_BREAKPOINTS: readonly number[] = [320, 480, 640, 960, 1280, 1600, 2048];
export const DEFAULT_FORMATS: readonly OutputFormat[] = ['avif', 'webp'];

const OUTPUT_FORMATS: ReadonlySet<string> = new Set(['avif', 'webp', 'png', 'jpeg']);
const OP_KEYS: ReadonlySet<string> = new Set([
	'aspect',
	'position',
	'rotate',
	'flip',
	'flop',
	'grayscale',
	'blur',
	'sharpen',
	'normalize',
	'negate',
	'gamma',
	'tint',
	'modulate'
]);
const IMAGE_KEYS: ReadonlySet<string> = new Set([
	'quality',
	'formats',
	'width',
	'placeholder',
	'ops'
]);
const PLUGIN_KEYS: ReadonlySet<string> = new Set([
	'quality',
	'formats',
	'placeholder',
	'breakpoints',
	'markdown'
]);
const ASPECT_RE = /^\s*(\d+(?:\.\d+)?)\s*[/:]\s*(\d+(?:\.\d+)?)\s*$/;

function unknown_keys(where: string, value: object, known: ReadonlySet<string>): void {
	for (const key of Object.keys(value))
		if (!known.has(key))
			throw new OgygiaError('image_option_unknown', {
				where,
				key,
				known: [...known].join(', ')
			});
}

function invalid(where: string, key: string, rule: string): never {
	throw new OgygiaError('image_option_invalid', { where, key, rule });
}

function check_quality(where: string, q: unknown): void {
	if (q !== undefined && !(Number.isInteger(q) && (q as number) >= 1 && (q as number) <= 100))
		invalid(where, 'quality', 'a whole number from 1 to 100');
}

function check_formats(where: string, f: unknown): void {
	if (f === undefined) return;
	if (!Array.isArray(f) || f.length === 0 || f.some((x) => !OUTPUT_FORMATS.has(x as string)))
		invalid(where, 'formats', `a non-empty list of ${[...OUTPUT_FORMATS].join(', ')}`);
}

/** The aspect ratio an `aspect` op asks for (width / height), or null. */
export function parse_aspect(aspect: number | string | undefined): number | null {
	if (aspect === undefined) return null;
	if (typeof aspect === 'number') return aspect > 0 && Number.isFinite(aspect) ? aspect : null;
	const m = ASPECT_RE.exec(aspect);
	if (!m) return null;
	const w = Number(m[1]);
	const h = Number(m[2]);
	return w > 0 && h > 0 ? w / h : null;
}

/** Check one image's options (`where` names the call in a message). */
export function check_image_options(where: string, o: unknown): ImageOptions {
	if (o === undefined) return {};
	if (o === null || typeof o !== 'object' || Array.isArray(o))
		invalid(where, 'options', 'an object');
	unknown_keys(where, o, IMAGE_KEYS);
	const opts = o as ImageOptions;
	check_quality(where, opts.quality);
	check_formats(where, opts.formats);
	if (opts.width !== undefined && !(Number.isInteger(opts.width) && opts.width > 0))
		invalid(where, 'width', 'a whole number of pixels above 0');
	if (opts.placeholder !== undefined && typeof opts.placeholder !== 'boolean')
		invalid(where, 'placeholder', 'true or false');
	if (opts.ops !== undefined) {
		if (opts.ops === null || typeof opts.ops !== 'object') invalid(where, 'ops', 'an object');
		unknown_keys(`${where} ops`, opts.ops, OP_KEYS);
		if (opts.ops.aspect !== undefined && parse_aspect(opts.ops.aspect) === null)
			invalid(where, 'ops.aspect', "a ratio above 0, like 16 / 9 or '16/9'");
	}
	return opts;
}

/** Check the plugin's options. */
export function check_plugin_options(o: unknown): ImagePluginOptions {
	const where = 'image()';
	if (o === undefined) return {};
	if (o === null || typeof o !== 'object' || Array.isArray(o))
		invalid(where, 'options', 'an object');
	unknown_keys(where, o, PLUGIN_KEYS);
	const opts = o as ImagePluginOptions;
	check_quality(where, opts.quality);
	check_formats(where, opts.formats);
	if (opts.placeholder !== undefined && typeof opts.placeholder !== 'boolean')
		invalid(where, 'placeholder', 'true or false');
	if (
		opts.breakpoints !== undefined &&
		(!Array.isArray(opts.breakpoints) ||
			opts.breakpoints.length === 0 ||
			opts.breakpoints.some((b) => !(Number.isInteger(b) && b > 0)))
	)
		invalid(where, 'breakpoints', 'a non-empty list of whole numbers above 0');
	if (opts.markdown !== undefined && opts.markdown !== false) {
		if (opts.markdown === null || typeof opts.markdown !== 'object')
			invalid(where, 'markdown', 'an object or false');
		unknown_keys(`${where} markdown`, opts.markdown, new Set(['width']));
		const w = opts.markdown.width;
		if (w !== undefined && !(Number.isInteger(w) && w > 0))
			invalid(where, 'markdown.width', 'a whole number of pixels above 0');
	}
	return opts;
}

/** The widths to write an image of intrinsic width `intrinsic` at. */
export function ladder(
	intrinsic: number,
	breakpoints: readonly number[],
	display: number | undefined
): number[] {
	const out = new Set<number>();
	if (display !== undefined) {
		const cap = display * 2;
		out.add(Math.min(display, intrinsic));
		for (const b of breakpoints) if (b > display && b < cap && b < intrinsic) out.add(b);
		out.add(Math.min(cap, intrinsic));
	} else {
		const top = Math.max(...breakpoints);
		for (const b of breakpoints) if (b < intrinsic) out.add(b);
		out.add(Math.min(intrinsic, top));
	}
	return [...out].sort((a, b) => a - b);
}
