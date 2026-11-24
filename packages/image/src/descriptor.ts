/**
 * The image descriptor: what a page holds for one image. Plain data (JSON-safe), so it crosses island
 * props, rides `refs()`, sits in frontmatter and is written into a module as a literal. The pixels are
 * the files its `variants` name; the browser pays for those by URL.
 */

/** An encoded format a variant is written in. `svg` and `gif` are passed through, never re-encoded
 *  into themselves. */
export type ImageFormat = 'avif' | 'webp' | 'png' | 'jpeg' | 'gif' | 'svg';

/** One encoded file of an image: its URL, format and pixel width. */
export interface ImageVariant {
	src: string;
	format: ImageFormat;
	width: number;
}

/** One image, ready to render: its variants and intrinsic size. */
export interface ImageDescriptor {
	/** The image's identity: a hash of its source bytes and the operations applied to them. */
	id: string;
	/** Every encoded file, by format then width (ascending). */
	variants: ImageVariant[];
	/** Intrinsic width, in pixels (after the operations). */
	width: number;
	/** Intrinsic height, in pixels (after the operations). */
	height: number;
	/** A placeholder token: `thumbhash:<base64>`. Absent when the image has none (transparent, an SVG,
	 *  or `placeholder: false`). */
	ph?: string;
	/** The image moves (an animated GIF or WebP): its variants keep every frame. */
	animated?: boolean;
	/** Alt text the source carries (a markdown image's text). */
	alt?: string;
}

/** Is `value` an image descriptor? For a schema: `v.custom<ImageDescriptor>(isImage)` (valibot) or
 *  `z.custom<ImageDescriptor>(isImage)` (zod) for a frontmatter image field. A path that did not
 *  resolve to a file stays a string, and fails this. */
export function isImage(value: unknown): value is ImageDescriptor {
	if (value === null || typeof value !== 'object') return false;
	const v = value as Partial<ImageDescriptor>;
	return (
		typeof v.id === 'string' &&
		typeof v.width === 'number' &&
		typeof v.height === 'number' &&
		Array.isArray(v.variants) &&
		v.variants.length > 0
	);
}
