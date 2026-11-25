/**
 * Layout intent → the files to ask for and the attributes an `<img>` / `<picture>` needs. The author
 * says how the image sits on the page (`constrained`, `fullWidth`, `fixed`, a box's shape) and at most
 * a display width; the candidate files (each a recipe), the srcset, `sizes`, the width and height
 * attributes and the preload come from that, the source and the plugin's settings. Pure: the URL of
 * each recipe comes from `url`, so the component, the markdown pipeline, the benches and the tests all
 * read the same answer.
 *
 * @packageDocumentation
 */
import type { ImageDescriptor, ImageFormat } from './descriptor.ts';
import {
	parse_aspect,
	type ImageLayout,
	type ImagePosition,
	type ImagePreset,
	type OutputFormat,
	type RenderConfig
} from './config.ts';
import { POSITIONS, SIDE_MAX, SOURCE_ID_RE, type Recipe } from './recipe.ts';
import { RenderError } from './render-messages.ts';

const PLACEHOLDER_RE = /^data:image\/webp;base64,[A-Za-z0-9+/]+={0,2}$/;

export type { ImageLayout } from './config.ts';

/** What the author asks for. */
export interface LayoutRequest {
	layout?: ImageLayout;
	/** Display width in CSS pixels. */
	width?: number;
	/** Display height in CSS pixels. With `width`, the image is cropped to that box. */
	height?: number;
	/** The box's shape (`16 / 9`, `'1/1'`): the files are cropped to it. */
	aspect?: number | string;
	/** Where a crop keeps. */
	position?: ImagePosition;
	/** Replaces the derived `sizes`. Only for a layout the three intents cannot say. */
	sizes?: string;
	quality?: number;
	formats?: readonly OutputFormat[];
}

/** One `<source>`: a candidate set, for the browsers its `media` and `type` match. */
export interface LaidSource {
	/** The media condition it is chosen by (a dark or an art-directed image), if any. */
	media?: string;
	/** Its format's MIME type, if it names one. */
	type?: string;
	srcset: string;
	/** Its own `sizes`, when not the `<img>`'s. */
	sizes?: string;
	/** Its own box, when not the `<img>`'s (a crop of another shape). */
	width?: number;
	height?: number;
}

/** What to render. */
export interface Laid {
	/** The `width` / `height` attributes: the display box, so the page reserves the space. */
	width: number;
	height: number;
	/** `<source>` elements in the order the browser tries them: best format first. Empty when there
	 *  is one format. */
	sources: LaidSource[];
	/** The `<img>` itself: its fallback `src`, and its own `srcset` (the most compatible format). */
	src: string;
	srcset?: string;
	sizes?: string;
	/** The box has its own shape (a width and a height, or an aspect): the files are cut to it, and
	 *  the `<img>` keeps it (`aspect-ratio`, `object-fit: cover`). */
	cover: boolean;
	/** For a preload: the best format's candidates. */
	preload: { type: string; srcset?: string; sizes?: string; href: string };
}

const MIME: Readonly<Record<ImageFormat, string>> = {
	avif: 'image/avif',
	webp: 'image/webp',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	svg: 'image/svg+xml',
	tiff: 'image/tiff'
};

/** The MIME type of a format. */
export function mime_of(format: ImageFormat): string {
	return MIME[format];
}

const SAME_SHAPE = 0.005;

function file_widths(
	layout: ImageLayout,
	width: number,
	widest: number,
	breakpoints: readonly number[]
): number[] {
	if (layout === 'fixed') {
		const one = Math.min(width, widest);
		const two = Math.min(width * 2, widest);
		return one === two ? [one] : [one, two];
	}
	const out = new Set<number>();
	if (layout === 'fullWidth') {
		for (const b of breakpoints) if (b < widest) out.add(b);
		out.add(Math.min(widest, Math.max(...breakpoints)));
	} else {
		const cap = width * 2;
		for (const b of breakpoints) if (b < cap && b < widest) out.add(b);
		out.add(Math.min(width, widest));
		out.add(Math.min(cap, widest));
	}
	return [...out].sort((a, b) => a - b);
}

function snapped(widths: readonly number[], allowed: readonly number[], widest: number): number[] {
	const last = allowed[allowed.length - 1]!;
	const out = new Set(widths.map((w) => Math.min(widest, allowed.find((s) => s >= w) ?? last)));
	return [...out].sort((a, b) => a - b);
}

/** The request a preset makes, `own` props over it (the layout `constrained` when neither says). */
export function preset_request(p: ImagePreset, own: LayoutRequest = {}): LayoutRequest {
	return {
		layout: own.layout ?? p.layout ?? 'constrained',
		width: own.width ?? p.width,
		height: own.height ?? p.height,
		aspect: own.aspect ?? p.aspect,
		position: own.position ?? p.position,
		sizes: own.sizes ?? p.sizes,
		quality: own.quality ?? p.quality,
		formats: own.formats ?? p.formats
	};
}

/** Do `a` and `b` ask for the same files? (`sizes` changes no file.) */
export function same_files(a: LayoutRequest, b: LayoutRequest): boolean {
	return (
		a.layout === b.layout &&
		a.width === b.width &&
		a.height === b.height &&
		String(a.aspect) === String(b.aspect) &&
		a.position === b.position &&
		a.quality === b.quality &&
		String(a.formats) === String(b.formats)
	);
}

function derived_sizes(layout: ImageLayout, width: number): string | undefined {
	if (layout === 'fixed') return undefined;
	if (layout === 'fullWidth') return '100vw';
	return `(min-width: ${width}px) ${width}px, 100vw`;
}

function invalid(prop: string, value: unknown, want: string): never {
	throw new RenderError('image_prop_invalid', { prop, value: String(value), want });
}

function whole_pixels(prop: string, n: number | undefined): number | undefined {
	if (n === undefined) return undefined;
	if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0)
		invalid(prop, n, 'a number of pixels above 0');
	return Math.max(1, Math.round(n));
}

function at_least_one(n: number): number {
	return Math.max(1, Math.round(n));
}

/** Lay out `image` the way `req` asks, with the plugin's settings `cfg`; `url` names each file. A
 *  fraction of a pixel is rounded; a size, aspect or quality no file can have is `image_prop_invalid`. */
export function lay_out(
	image: ImageDescriptor,
	req: LayoutRequest,
	cfg: RenderConfig,
	url: (recipe: Recipe) => string
): Laid {
	if (!SOURCE_ID_RE.test(image.id)) invalid('of.id', image.id, 'an id the build made');
	if (image.ph !== undefined && !PLACEHOLDER_RE.test(image.ph))
		invalid('of.ph', image.ph, 'a placeholder the build made (a WebP data URL)');
	const layout = req.layout ?? 'constrained';
	const asked_width = whole_pixels('width', req.width);
	const asked_height = whole_pixels('height', req.height);
	const aspect = parse_aspect(req.aspect);
	if (req.aspect !== undefined && aspect === null)
		invalid('aspect', req.aspect, "a ratio above 0, like 16 / 9 or '16/9'");
	if (
		req.quality !== undefined &&
		!(Number.isInteger(req.quality) && req.quality >= 1 && req.quality <= 100)
	)
		invalid('quality', req.quality, 'a whole number from 1 to 100');
	if (req.position !== undefined && !POSITIONS.has(req.position))
		invalid('position', req.position, `one of ${[...POSITIONS].join(', ')}`);
	const own = image.width / image.height;
	const boxed = asked_width !== undefined && asked_height !== undefined;
	const shape = boxed ? asked_width / asked_height : aspect;
	const ratio = shape ?? own;
	const svg = image.format === 'svg';
	const crop = !svg && Math.abs(ratio - own) / own > SAME_SHAPE;
	if (crop && image.height * ratio < 1)
		invalid(
			boxed ? 'height' : 'aspect',
			boxed ? asked_height : req.aspect,
			`a box the source can fill: at most ${image.height} times as tall as it is wide`
		);
	const widest = crop ? Math.min(image.width, at_least_one(image.height * ratio)) : image.width;

	let width: number;
	if (layout === 'fullWidth') width = widest;
	else if (asked_width !== undefined) width = asked_width;
	else if (asked_height !== undefined) width = at_least_one(asked_height * ratio);
	else width = widest;
	if (layout === 'constrained' && !svg && !boxed) width = Math.min(width, widest);
	const height = boxed ? asked_height : at_least_one(width / ratio);
	const cover = shape !== null;

	if (svg)
		return {
			width,
			height,
			sources: [],
			src: image.src,
			cover,
			preload: { type: MIME.svg, href: image.src }
		};

	const formats: readonly ImageFormat[] = image.animated ? ['webp'] : (req.formats ?? cfg.formats);
	const quality = req.quality ?? image.quality ?? cfg.quality;
	const position =
		crop && req.position !== undefined && req.position !== 'center' && req.position !== 'centre'
			? req.position
			: undefined;
	const ladder = file_widths(layout, width, widest, cfg.breakpoints);
	const widths = cfg.widths?.length ? snapped(ladder, cfg.widths, widest) : ladder;
	const sizes = req.sizes ?? derived_sizes(layout, width);

	const widest_file = widths[widths.length - 1]!;
	if (widest_file > SIDE_MAX)
		invalid('width', req.width ?? width, `at most ${SIDE_MAX}: no image file is wider`);
	if (Math.round(widest_file / ratio) > SIDE_MAX)
		invalid('height', req.height ?? height, `at most ${SIDE_MAX}: no image file is taller`);
	const recipe = (w: number, format: ImageFormat): Recipe => ({
		id: image.id,
		src: image.src,
		width: w,
		height: Math.max(1, Math.round(w / ratio)),
		format,
		...(quality !== undefined ? { quality } : {}),
		...(position !== undefined ? { position } : {}),
		...(image.ops ? { ops: image.ops } : {}),
		...(crop ? { crop: true } : {}),
		source: { format: image.format, ...(image.animated ? { animated: true } : {}) }
	});
	const at_least = (format: ImageFormat, w: number): string =>
		url(recipe(widths.find((x) => x >= w) ?? widths[widths.length - 1]!, format));
	const candidates = (format: ImageFormat): string =>
		layout === 'fixed'
			? widths.map((w, i) => `${url(recipe(w, format))} ${i + 1}x`).join(', ')
			: widths.map((w) => `${url(recipe(w, format))} ${w}w`).join(', ');

	const sets = formats.map((format) => ({ type: MIME[format], srcset: candidates(format) }));
	const fallback = formats[formats.length - 1]!;
	const best = sets[0]!;
	return {
		width,
		height,
		sources: sets.slice(0, -1),
		src: at_least(fallback, width),
		srcset: sets[sets.length - 1]!.srcset,
		sizes,
		cover,
		preload: {
			type: best.type,
			srcset: best.srcset,
			sizes,
			href: at_least(formats[0]!, width)
		}
	};
}
