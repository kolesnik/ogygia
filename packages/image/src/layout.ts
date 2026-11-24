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
import type { Recipe } from './recipe.ts';

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

/** One `<source>`: a format's candidates. */
export interface LaidSource {
	type: string;
	srcset: string;
}

/** What to render. */
export interface Laid {
	/** The `width` / `height` attributes: the display box, so the page reserves the space. */
	width: number;
	height: number;
	/** `<source>` elements, best format first. Empty when there is one format. */
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

/** Lay out `image` the way `req` asks, with the plugin's settings `cfg`; `url` names each file. */
export function lay_out(
	image: ImageDescriptor,
	req: LayoutRequest,
	cfg: RenderConfig,
	url: (recipe: Recipe) => string
): Laid {
	const layout = req.layout ?? 'constrained';
	const own = image.width / image.height;
	const boxed = req.width !== undefined && req.height !== undefined;
	const shape = boxed ? req.width! / req.height! : parse_aspect(req.aspect);
	const ratio = shape ?? own;
	const svg = image.format === 'svg';
	const crop = !svg && Math.abs(ratio - own) / own > SAME_SHAPE;
	const widest = crop ? Math.min(image.width, Math.round(image.height * ratio)) : image.width;

	let width: number;
	if (layout === 'fullWidth') width = widest;
	else if (req.width !== undefined) width = req.width;
	else if (req.height !== undefined) width = Math.round(req.height * ratio);
	else width = widest;
	if (layout === 'constrained' && !svg && !boxed) width = Math.min(width, widest);
	const height = boxed ? req.height! : Math.round(width / ratio);
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
	const widths = file_widths(layout, width, widest, cfg.breakpoints);
	const sizes = req.sizes ?? derived_sizes(layout, width);

	const recipe = (w: number, format: ImageFormat): Recipe => ({
		id: image.id,
		src: image.src,
		width: w,
		height: Math.max(1, Math.round(w / ratio)),
		format,
		...(quality !== undefined ? { quality } : {}),
		...(position !== undefined ? { position } : {}),
		...(image.ops ? { ops: image.ops } : {})
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
