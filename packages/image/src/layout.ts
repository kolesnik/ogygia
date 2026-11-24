/**
 * Layout intent → the attributes an `<img>` / `<picture>` needs. The author says how the image sits on
 * the page (`constrained`, `fullWidth`, `fixed`) and at most a display width; the srcset, `sizes`, the
 * width and height attributes and the preload come from that and the descriptor. Pure, so the
 * component, the markdown pipeline and the tests all read the same answer.
 *
 * @packageDocumentation
 */
import type { ImageDescriptor, ImageFormat, ImageVariant } from './descriptor.ts';

/**
 * How the image sits on the page:
 * - `constrained` (default): as wide as `width` (the intrinsic width when left out), shrinking with
 *   its container.
 * - `fullWidth`: the container's whole width, whatever the screen.
 * - `fixed`: exactly `width` × `height` CSS pixels, at 1× and 2× density.
 */
export type ImageLayout = 'constrained' | 'fullWidth' | 'fixed';

/** What the author asks for. */
export interface LayoutRequest {
	layout?: ImageLayout;
	/** Display width in CSS pixels. */
	width?: number;
	/** Display height in CSS pixels. With `width`, the image is cropped to that box (`object-fit`). */
	height?: number;
	/** Replaces the derived `sizes`. Only for a layout the three intents cannot say. */
	sizes?: string;
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
	/** Both a width and a height were given: the image fills that box, cropped (`object-fit: cover`). */
	cover: boolean;
	/** For a preload: the best format's candidates. */
	preload: { type: string; srcset?: string; sizes?: string; href: string };
}

const FORMAT_RANK: Readonly<Record<ImageFormat, number>> = {
	avif: 0,
	webp: 1,
	jpeg: 2,
	png: 3,
	gif: 4,
	svg: 5
};

const MIME: Readonly<Record<ImageFormat, string>> = {
	avif: 'image/avif',
	webp: 'image/webp',
	jpeg: 'image/jpeg',
	png: 'image/png',
	gif: 'image/gif',
	svg: 'image/svg+xml'
};

/** The MIME type of a format. */
export function mime_of(format: ImageFormat): string {
	return MIME[format];
}

function by_format(variants: readonly ImageVariant[]): ImageVariant[][] {
	const groups = new Map<ImageFormat, ImageVariant[]>();
	for (const v of variants) {
		let g = groups.get(v.format);
		if (!g) groups.set(v.format, (g = []));
		g.push(v);
	}
	return [...groups.entries()]
		.sort((a, b) => FORMAT_RANK[a[0]] - FORMAT_RANK[b[0]])
		.map(([, g]) => g.sort((a, b) => a.width - b.width));
}

function at_least(group: readonly ImageVariant[], w: number): ImageVariant {
	for (const v of group) if (v.width >= w) return v;
	return group[group.length - 1]!;
}

function candidates(
	group: readonly ImageVariant[],
	layout: ImageLayout,
	display: number
): string | undefined {
	if (group.length === 1 && group[0]!.format === 'svg') return undefined;
	if (layout === 'fixed') {
		const one = at_least(group, display);
		const two = at_least(group, display * 2);
		return one === two ? `${one.src} 1x` : `${one.src} 1x, ${two.src} 2x`;
	}
	let picked: readonly ImageVariant[] = group;
	if (layout === 'constrained') {
		const cap = display * 2;
		const under = group.filter((v) => v.width < cap);
		const over = group.find((v) => v.width >= cap);
		picked = over ? [...under, over] : under;
	}
	return picked.map((v) => `${v.src} ${v.width}w`).join(', ');
}

function derived_sizes(
	layout: ImageLayout,
	width: number,
	drawn: number,
	scale: number
): string | undefined {
	if (layout === 'fixed') return undefined;
	const vw = `${Math.round(100 * scale)}vw`;
	if (layout === 'fullWidth') return vw;
	return `(min-width: ${width}px) ${drawn}px, ${vw}`;
}

/** Lay out `image` the way `req` asks. */
export function lay_out(image: ImageDescriptor, req: LayoutRequest = {}): Laid {
	const layout = req.layout ?? 'constrained';
	const ratio = image.height / image.width;
	const cover = req.width !== undefined && req.height !== undefined;
	const groups = by_format(image.variants);
	const svg = groups.length === 1 && groups[0]![0]!.format === 'svg';
	let width: number;
	if (layout === 'fullWidth') width = image.width;
	else if (req.width !== undefined) width = req.width;
	else if (req.height !== undefined) width = Math.round(req.height / ratio);
	else width = image.width;
	if (layout === 'constrained' && !svg && !cover) width = Math.min(width, image.width);
	const height = cover ? req.height! : Math.round(width * ratio);
	const scale = cover ? Math.max(1, height / ratio / width) : 1;
	const drawn = Math.round(width * scale);
	const sizes = svg ? undefined : (req.sizes ?? derived_sizes(layout, width, drawn, scale));

	const sets = groups.map((g) => ({
		type: mime_of(g[0]!.format),
		srcset: candidates(g, layout, drawn)
	}));
	const fallback_group = groups[groups.length - 1]!;
	const fallback = at_least(fallback_group, drawn);
	const best = sets[0]!;
	return {
		width,
		height,
		sources:
			groups.length > 1 ? sets.slice(0, -1).map((s) => ({ type: s.type, srcset: s.srcset! })) : [],
		src: fallback.src,
		srcset: sets[sets.length - 1]!.srcset,
		sizes,
		cover,
		preload: {
			type: best.type,
			srcset: best.srcset,
			sizes,
			href: at_least(groups[0]!, drawn).src
		}
	};
}
