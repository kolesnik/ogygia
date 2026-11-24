/**
 * The image descriptor: what a page holds for one image SOURCE. Plain data (JSON-safe), so it crosses
 * island props, rides `refs()`, sits in frontmatter and is written into a module as a literal. It names
 * no encoded file: `<Img>` decides those at render (the layout, the preset) and the image endpoint
 * makes each one the first time it is asked for.
 *
 * @packageDocumentation
 */

/** A format an image is in: a source's own, or one a page asks for. */
export type ImageFormat = 'avif' | 'webp' | 'png' | 'jpeg' | 'gif' | 'svg' | 'tiff';

/** Pixel operations a source carries (the macro's `ops`), applied before any resize or crop, in this
 *  order. Each is sharp's operation of that name. */
export interface ImageOps {
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

/** One image source, ready to render. */
export interface ImageDescriptor {
	/** The source's identity: a hash of its bytes and its operations. */
	id: string;
	/** The original file, shipped as an asset: what the image endpoint reads, and what a browser-only
	 *  render shows. */
	src: string;
	/** Intrinsic width, in pixels (after the operations). */
	width: number;
	/** Intrinsic height, in pixels (after the operations). */
	height: number;
	/** The source's own format. */
	format: ImageFormat;
	/** The placeholder: a tiny (16 px wide) WebP of the image as a data URL
	 *  (`data:image/webp;base64,…`, about 100 bytes), painted behind the image until it loads. Absent
	 *  when the image has none (transparent, an SVG, or `placeholder: false`). */
	ph?: string;
	/** The image moves (an animated GIF or WebP): every file made from it keeps every frame. */
	animated?: boolean;
	/** Encoder quality the source asks for (1–100). */
	quality?: number;
	/** Pixel operations the source carries. */
	ops?: ImageOps;
	/** Alt text the source carries (a markdown image's text). */
	alt?: string;
}

/** Is `value` an image descriptor? For a schema: `v.custom<ImageDescriptor>(isImage)` (valibot) or
 *  `z.custom<ImageDescriptor>(isImage)` (zod) for a frontmatter image field, or {@link image}. Only a
 *  frontmatter value written with `./` or `../` and an image extension becomes a descriptor (a
 *  missing file fails the build); any other string (`images/share.png`) stays a string, and fails
 *  this. */
export function isImage(value: unknown): value is ImageDescriptor {
	if (value === null || typeof value !== 'object') return false;
	const v = value as Partial<ImageDescriptor>;
	return (
		typeof v.id === 'string' &&
		typeof v.src === 'string' &&
		typeof v.width === 'number' &&
		typeof v.height === 'number' &&
		typeof v.format === 'string'
	);
}

/** A Standard Schema (v1) for one image field: what {@link image} returns. It is also the
 *  {@link isImage} check itself, so it fits `v.custom<ImageDescriptor>(image())` too. */
export interface ImageField {
	(value: unknown): value is ImageDescriptor;
	readonly '~standard': {
		readonly version: 1;
		readonly vendor: 'ogygia';
		readonly validate: (
			value: unknown
		) => { value: ImageDescriptor } | { issues: ReadonlyArray<{ message: string }> };
		readonly types?: { readonly input: unknown; readonly output: ImageDescriptor };
	};
}

/**
 * A frontmatter image field: a Standard Schema that takes a descriptor (what `cover: ./cover.jpg`
 * becomes) and refuses anything else with a message that says how to write one. Use it where a
 * schema library takes a Standard Schema, or as the check of a custom field:
 *
 * ```ts
 * schema: v.object({ title: v.string(), cover: v.custom<ImageDescriptor>(image()) })
 * ```
 */
export function image(): ImageField {
	const check = ((value: unknown) => isImage(value)) as ImageField;
	const validate = (value: unknown) => {
		if (isImage(value)) return { value };
		const message =
			typeof value === 'string'
				? `"${value}" is not an image: a frontmatter image is a path that starts with ./ or ../ and names an image file beside the document`
				: 'expected an image (a frontmatter path like ./cover.jpg, or import.meta.og.image())';
		return { issues: [{ message }] };
	};
	Object.defineProperty(check, '~standard', {
		value: { version: 1, vendor: 'ogygia', validate },
		enumerable: false
	});
	return check;
}
