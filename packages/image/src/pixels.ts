/**
 * The pixels: sharp, for the two moments that touch them. At compile a source is measured and its
 * placeholder made (./vite/plan.ts); at settle one recipe is encoded (./settle.ts). Both read the
 * source the same way: EXIF orientation applied, then the source's operations, then the box.
 *
 * @packageDocumentation
 */
import sharp, { type Metadata, type Sharp } from 'sharp';
import type { ImageFormat, ImageOps } from './descriptor.ts';

/** Bump when the encoder's output changes for the same input: every cached file is made again. */
export const ENCODER_VERSION = 3;

/** The libvips version the files are made with: part of every cache key. */
export const VIPS_VERSION: string = sharp.versions.vips;

/** A source's shown size: its stored size turned by its EXIF orientation and its operations. */
export function shown_size(
	meta: Metadata,
	ops: ImageOps,
	animated: boolean
): { width: number; height: number } {
	let w = meta.width;
	let h = animated && meta.pageHeight ? meta.pageHeight : meta.height;
	// @why EXIF orientations 5–8 store the picture turned a quarter, so its stored width is its shown height (test: packages/image/test/encode.test.ts › EXIF orientation is applied: a portrait stored sideways reports its shown size)
	if ((meta.orientation ?? 1) >= 5) [w, h] = [h, w];
	if (ops.rotate && Math.abs(ops.rotate) % 180 === 90) [w, h] = [h, w];
	return { width: w, height: h };
}

/** The source's metadata, every frame counted. */
export function metadata_of(bytes: Uint8Array): Promise<Metadata> {
	return sharp(bytes, { animated: true, limitInputPixels: false }).metadata();
}

/** The source → `width` × `height`, cut to that box around `position`. */
export function pipeline(
	bytes: Uint8Array,
	ops: ImageOps,
	animated: boolean,
	width: number,
	height: number,
	position?: string
): Sharp {
	let img = sharp(bytes, { animated, limitInputPixels: false }).autoOrient();
	if (ops.rotate) img = img.rotate(ops.rotate);
	if (ops.flip) img = img.flip();
	if (ops.flop) img = img.flop();
	if (ops.grayscale) img = img.grayscale();
	if (ops.blur) img = img.blur(ops.blur);
	if (ops.sharpen) img = img.sharpen();
	if (ops.normalize) img = img.normalize();
	if (ops.negate) img = img.negate();
	if (ops.gamma) img = img.gamma(ops.gamma);
	if (ops.tint) img = img.tint(ops.tint);
	if (ops.modulate) img = img.modulate(ops.modulate);
	return img.resize({ width, height, fit: 'cover', position: position_of(position) });
}

function position_of(position: string | undefined): string | number {
	if (position === 'attention' || position === 'entropy') return sharp.strategy[position];
	if (position === undefined || position === 'center') return 'centre';
	return position;
}

/** One file's bytes: the source at `width` × `height` in `format`. */
export async function encode(
	bytes: Uint8Array,
	file: {
		width: number;
		height: number;
		format: ImageFormat;
		quality?: number;
		position?: string;
		ops?: ImageOps;
	},
	animated: boolean
): Promise<Buffer> {
	let img = pipeline(bytes, file.ops ?? {}, animated, file.width, file.height, file.position);
	const q = file.quality;
	if (file.format === 'avif') img = img.avif({ quality: q ?? 60, effort: 4 });
	else if (file.format === 'webp')
		img = img.webp({ quality: q ?? 80, effort: 4, ...(animated ? { loop: 0 } : {}) });
	else if (file.format === 'jpeg') img = img.jpeg({ quality: q ?? 80, mozjpeg: true });
	else img = img.png({ compressionLevel: 9, ...(q !== undefined ? { quality: q } : {}) });
	return img.toBuffer();
}

const PLACEHOLDER_WIDTH = 16;

/** The placeholder of a source of shown `size`: a 16 px WebP data URL, or undefined for a source
 *  that is not opaque (a blur would show through it). */
export async function placeholder_of(
	bytes: Uint8Array,
	ops: ImageOps,
	size: { width: number; height: number }
): Promise<string | undefined> {
	const w = Math.min(PLACEHOLDER_WIDTH, size.width);
	const h = Math.max(1, Math.round((w * size.height) / size.width));
	const { data } = await pipeline(bytes, ops, false, w, h)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return undefined;
	const tiny = await pipeline(bytes, ops, false, w, h)
		.removeAlpha()
		.webp({ quality: 50, effort: 6 })
		.toBuffer();
	return `data:image/webp;base64,${tiny.toString('base64')}`;
}
