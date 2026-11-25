/**
 * The options: the plugin's (`image({ … })`: formats, ladder, quality, presets, markdown) and one
 * source's own (`import.meta.og.image(src, { … })`: what belongs to the source itself). Both are plain
 * JSON, checked here, so a typo fails the build instead of being ignored.
 *
 * @packageDocumentation
 */
import type { ImageOps } from '../descriptor.ts';
import { parse_aspect, type ImagePreset, type OutputFormat } from '../config.ts';
import { OgygiaError } from '../messages.ts';
import { POSITIONS } from '../recipe.ts';

export type { ImageOps } from '../descriptor.ts';
export type { ImageLayout, ImagePosition, ImagePreset, OutputFormat } from '../config.ts';

/** One source's options: what belongs to the file, whatever page shows it. */
export interface ImageOptions {
	/** Encoder quality, 1–100, for every file made from this source. Default: 60 for AVIF, 80 for
	 *  the others. */
	quality?: number;
	/** Paint a blur placeholder until the image arrives. Default `true` (never for a transparent
	 *  image or an SVG). */
	placeholder?: boolean;
	/** Pixel operations, applied before any resize or crop. */
	ops?: ImageOps;
	/** Make these presets' files at build (`'cover'`, or `['cover', 'thumb']`), for a page rendered
	 *  on a live server: `<Img preset="cover">` of this source then names static files the build
	 *  made instead of asking the endpoint. A prerendered page needs none: its render asks already. */
	warm?: string | string[];
}

/** The plugin's options: every image's defaults, the presets, and markdown's. */
export interface ImagePluginOptions {
	quality?: number;
	/** The formats to offer, best first. Default `['avif', 'webp']`. An animated image is offered as
	 *  animated WebP whatever this says. */
	formats?: OutputFormat[];
	placeholder?: boolean;
	/** The width ladder a responsive image is offered at (capped at the image's own width). Default
	 *  `[320, 480, 640, 960, 1280, 1600, 2048]`. */
	breakpoints?: number[];
	/** Named ways to show an image, chosen with `<Img preset="…">` (own props say over them):
	 *  `{ thumb: { width: 400, aspect: '1/1' }, cover: { layout: 'fullWidth', aspect: '16/9',
	 *  priority: true } }`. A markdown body image uses `prose` when there is one. */
	presets?: Record<string, ImagePreset>;
	/** Markdown images (with `@ogygia/content`): `width` is the prose column's width, in CSS pixels,
	 *  when there is no `prose` preset; `animated` names the preset a moving image (an animated GIF
	 *  or WebP) takes instead, with its own width and `sizes`; `false` leaves markdown images as
	 *  plain `<img>`. Default `{}` (each image as wide as itself). */
	markdown?: { width?: number; animated?: string } | false;
}

export { DEFAULT_BREAKPOINTS, DEFAULT_FORMATS } from '../config.ts';

const OUTPUT_FORMATS: ReadonlySet<string> = new Set(['avif', 'webp', 'png', 'jpeg']);
const LAYOUTS: ReadonlySet<string> = new Set(['constrained', 'fullWidth', 'fixed']);
const OP_KEYS: ReadonlySet<string> = new Set([
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
const IMAGE_KEYS: ReadonlySet<string> = new Set(['quality', 'placeholder', 'ops', 'warm']);
const PLUGIN_KEYS: ReadonlySet<string> = new Set([
	'quality',
	'formats',
	'placeholder',
	'breakpoints',
	'presets',
	'markdown'
]);
const PRESET_KEYS: ReadonlySet<string> = new Set([
	'layout',
	'width',
	'height',
	'aspect',
	'position',
	'sizes',
	'priority',
	'placeholder',
	'morph',
	'quality',
	'formats'
]);
const MARKDOWN_KEYS: ReadonlySet<string> = new Set(['width', 'animated']);
const PRESET_NAME_RE = /^[A-Za-z][\w-]*$/;

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

function is_object(o: unknown): o is Record<string, unknown> {
	return o !== null && typeof o === 'object' && !Array.isArray(o);
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

function check_pixels(where: string, key: string, n: unknown): void {
	if (n !== undefined && !(Number.isInteger(n) && (n as number) > 0))
		invalid(where, key, 'a whole number of pixels above 0');
}

function check_boolean(where: string, key: string, b: unknown): void {
	if (b !== undefined && typeof b !== 'boolean') invalid(where, key, 'true or false');
}

/** Check one source's options (`where` names the call in a message; `presets`, the names
 *  `image({ presets })` declares, which `warm` may name). */
export function check_image_options(
	where: string,
	o: unknown,
	presets: readonly string[] = []
): ImageOptions {
	if (o === undefined) return {};
	if (!is_object(o)) invalid(where, 'options', 'an object');
	unknown_keys(where, o, IMAGE_KEYS);
	const opts = o as ImageOptions;
	check_quality(where, opts.quality);
	check_boolean(where, 'placeholder', opts.placeholder);
	if (opts.ops !== undefined) {
		if (!is_object(opts.ops)) invalid(where, 'ops', 'an object');
		unknown_keys(`${where} ops`, opts.ops, OP_KEYS);
	}
	if (opts.warm !== undefined) {
		const names = typeof opts.warm === 'string' ? [opts.warm] : opts.warm;
		if (!Array.isArray(names) || !names.length || names.some((n) => typeof n !== 'string'))
			invalid(where, 'warm', 'a preset name, or a non-empty list of them');
		for (const preset of names)
			if (!presets.includes(preset))
				throw new OgygiaError('image_warm_unknown', {
					where,
					preset,
					known: presets.join(', ') || '(none)'
				});
	}
	return opts;
}

/** Check one preset (`name` names it in a message). */
export function check_preset(name: string, o: unknown): ImagePreset {
	const where = `image() presets.${name}`;
	if (!is_object(o)) invalid(where, 'preset', 'an object');
	unknown_keys(where, o, PRESET_KEYS);
	const p = o as ImagePreset;
	if (p.layout !== undefined && !LAYOUTS.has(p.layout))
		invalid(where, 'layout', `one of ${[...LAYOUTS].join(', ')}`);
	check_pixels(where, 'width', p.width);
	check_pixels(where, 'height', p.height);
	if (p.aspect !== undefined && parse_aspect(p.aspect) === null)
		invalid(where, 'aspect', "a ratio above 0, like 16 / 9 or '16/9'");
	if (p.position !== undefined && !POSITIONS.has(p.position))
		invalid(where, 'position', `one of ${[...POSITIONS].join(', ')}`);
	if (p.sizes !== undefined && typeof p.sizes !== 'string') invalid(where, 'sizes', 'a string');
	check_boolean(where, 'priority', p.priority);
	check_boolean(where, 'placeholder', p.placeholder);
	check_boolean(where, 'morph', p.morph);
	check_quality(where, p.quality);
	check_formats(where, p.formats);
	return p;
}

/** Check the plugin's options. */
export function check_plugin_options(o: unknown): ImagePluginOptions {
	const where = 'image()';
	if (o === undefined) return {};
	if (!is_object(o)) invalid(where, 'options', 'an object');
	unknown_keys(where, o, PLUGIN_KEYS);
	const opts = o as ImagePluginOptions;
	check_quality(where, opts.quality);
	check_formats(where, opts.formats);
	check_boolean(where, 'placeholder', opts.placeholder);
	if (
		opts.breakpoints !== undefined &&
		(!Array.isArray(opts.breakpoints) ||
			opts.breakpoints.length === 0 ||
			opts.breakpoints.some((b) => !(Number.isInteger(b) && b > 0)))
	)
		invalid(where, 'breakpoints', 'a non-empty list of whole numbers above 0');
	if (opts.presets !== undefined) {
		if (!is_object(opts.presets)) invalid(where, 'presets', 'an object of named presets');
		for (const [name, preset] of Object.entries(opts.presets)) {
			if (!PRESET_NAME_RE.test(name))
				invalid(
					where,
					`presets.${name}`,
					'a name of letters, digits, - and _, starting with a letter'
				);
			check_preset(name, preset);
		}
	}
	if (opts.markdown !== undefined && opts.markdown !== false) {
		if (!is_object(opts.markdown)) invalid(where, 'markdown', 'an object or false');
		unknown_keys(`${where} markdown`, opts.markdown, MARKDOWN_KEYS);
		check_pixels(where, 'markdown.width', opts.markdown.width);
		const animated = opts.markdown.animated;
		const declared = Object.keys(opts.presets ?? {});
		if (animated !== undefined && !(typeof animated === 'string' && declared.includes(animated)))
			invalid(
				where,
				'markdown.animated',
				`the name of a preset image({ presets }) declares (declared: ${declared.join(', ') || '(none)'})`
			);
	}
	return opts;
}
