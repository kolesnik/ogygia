/**
 * The encoder: one image file → its plan (intrinsic size, placeholder, the variants to write), and
 * each variant's bytes. sharp does the pixels. Everything is content-addressed: the plan is kept in the
 * build cache by the image's id (its bytes, its options, the encoder's version), and each encoded file
 * is kept beside it, so a warm build or a dev restart encodes nothing it already has.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp, { type Metadata, type Sharp } from 'sharp';
import { rgbaToThumbHash } from 'thumbhash';
import { BuildCache } from '@ogygia/compiler';
import { flights, queue, STALE, type Place } from '@ogygia/machine';
import type { ImageFormat } from '../descriptor.ts';
import { OgygiaError } from '../messages.ts';
import {
	DEFAULT_BREAKPOINTS,
	DEFAULT_FORMATS,
	ladder,
	parse_aspect,
	type ImageOps,
	type ImageOptions,
	type ImagePluginOptions,
	type OutputFormat
} from './options.ts';

/** Bump when the encoder's output changes for the same input: every cached image is made again. */
const ENCODER_VERSION = 1;

/** One file the plan writes. */
export interface PlannedVariant {
	width: number;
	format: ImageFormat;
	/** File name: `<base>-<width>.<ext>`. */
	name: string;
}

/** What a file becomes. */
export interface Plan {
	id: string;
	width: number;
	height: number;
	animated: boolean;
	ph?: string;
	variants: PlannedVariant[];
}

/** The settings one image is encoded with: its own options over the plugin's. */
export interface Settings {
	quality?: number;
	formats: readonly OutputFormat[];
	placeholder: boolean;
	width?: number;
	ops: ImageOps;
	breakpoints: readonly number[];
}

/** One image's settings: its options over the plugin's defaults. */
export function settle(plugin: ImagePluginOptions, own: ImageOptions): Settings {
	return {
		quality: own.quality ?? plugin.quality,
		formats: own.formats ?? plugin.formats ?? DEFAULT_FORMATS,
		placeholder: own.placeholder ?? plugin.placeholder ?? true,
		width: own.width,
		ops: own.ops ?? {},
		breakpoints: plugin.breakpoints ?? DEFAULT_BREAKPOINTS
	};
}

const plans = new BuildCache<Plan>('image');

/** Where encoded files live: the build cache's image folder, else a temp folder. */
export function files_dir(): string {
	return plans.dir() ?? path.join(os.tmpdir(), 'ogygia-image');
}

/** The path a variant's bytes are kept at. */
export function variant_path(id: string, name: string): string {
	return path.join(files_dir(), id, name);
}

const VECTOR_RE = /\.svg$/i;
const EXT: Readonly<Record<ImageFormat, string>> = {
	avif: 'avif',
	webp: 'webp',
	png: 'png',
	jpeg: 'jpg',
	gif: 'gif',
	svg: 'svg'
};

/** A file's base name, safe for a URL: `My Photo.JPG` → `my-photo`. */
function base_of(file: string): string {
	const base = path.basename(file).replace(/\.[^.]+$/, '');
	return (
		base
			.toLowerCase()
			.replace(/[^a-z0-9._-]+/g, '-')
			.replace(/^-+|-+$/g, '') || 'image'
	);
}

function digest(parts: readonly (string | Uint8Array)[]): string {
	const h = crypto.createHash('sha256');
	for (const p of parts) {
		h.update(p);
		h.update('\0');
	}
	return h.digest('base64url').slice(0, 16);
}

/** At most this many encodes run at once: each holds a decoded image in memory. */
const MAX_ENCODES = Math.max(2, Math.min(8, Math.floor(os.availableParallelism() / 2)));

type Job = { run: () => Promise<void> };
const encodes = queue<Job>({
	name: 'image encodes',
	max: MAX_ENCODES,
	start: (job: Job, place: Place) => {
		void job.run().finally(() => place.release());
	}
});

/** Run `work` when a place is free. */
function limited<T>(work: () => Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		encodes.push({ run: () => work().then(resolve, reject) });
	});
}

/** The size after orientation and the operations that change it. */
function shaped(
	meta: Metadata,
	ops: ImageOps,
	animated: boolean
): { width: number; height: number } {
	let w = meta.width;
	let h = animated && meta.pageHeight ? meta.pageHeight : meta.height;
	// EXIF orientations 5–8 turn the picture a quarter: its stored width is its shown height
	if ((meta.orientation ?? 1) >= 5) [w, h] = [h, w];
	if (ops.rotate && Math.abs(ops.rotate) % 180 === 90) [w, h] = [h, w];
	const aspect = parse_aspect(ops.aspect);
	if (aspect !== null) {
		if (w / h > aspect) w = Math.round(h * aspect);
		else h = Math.round(w / aspect);
	}
	return { width: w, height: h };
}

/** The pipeline for one output: orientation, the operations, then the resize. */
function pipeline(
	bytes: Uint8Array,
	ops: ImageOps,
	animated: boolean,
	width: number,
	height: number
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
	const position =
		ops.position === 'attention' || ops.position === 'entropy'
			? sharp.strategy[ops.position]
			: (ops.position ?? 'centre');
	return img.resize({ width, height, fit: 'cover', position, withoutEnlargement: true });
}

/** The placeholder token for an opaque image, or undefined (transparent, or it failed to read). */
async function placeholder_of(
	bytes: Uint8Array,
	ops: ImageOps,
	size: { width: number; height: number }
): Promise<string | undefined> {
	const scale = 100 / Math.max(size.width, size.height);
	const w = Math.max(1, Math.round(size.width * Math.min(1, scale)));
	const h = Math.max(1, Math.round(size.height * Math.min(1, scale)));
	const { data, info } = await pipeline(bytes, ops, false, w, h)
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) return undefined;
	const hash = rgbaToThumbHash(info.width, info.height, data);
	return `thumbhash:${Buffer.from(hash).toString('base64')}`;
}

/** Plan one file: read it once, decide its variants, make its placeholder. Kept by id. */
export async function plan_image(file: string, settings: Settings): Promise<Plan> {
	let bytes: Buffer;
	try {
		bytes = fs.readFileSync(file);
	} catch {
		throw new OgygiaError('image_not_found', { file, src: file });
	}
	const id = digest([
		bytes,
		JSON.stringify({ ...settings, v: ENCODER_VERSION, vips: sharp.versions.vips })
	]);
	const kept = plans.get(id);
	if (kept) return kept;

	const base = base_of(file);
	if (VECTOR_RE.test(file)) {
		let meta: Metadata;
		try {
			meta = await sharp(bytes).metadata();
		} catch (e) {
			throw new OgygiaError('image_decode_failed', { file, reason: (e as Error).message });
		}
		const plan: Plan = {
			id,
			width: meta.width,
			height: meta.height,
			animated: false,
			variants: [{ width: meta.width, format: 'svg', name: `${base}.svg` }]
		};
		plans.set(id, plan);
		return plan;
	}

	let meta: Metadata;
	try {
		meta = await sharp(bytes, { animated: true, limitInputPixels: false }).metadata();
	} catch (e) {
		throw new OgygiaError('image_decode_failed', { file, reason: (e as Error).message });
	}
	const animated = (meta.pages ?? 1) > 1;
	const size = shaped(meta, settings.ops, animated);
	const widths = ladder(size.width, settings.breakpoints, settings.width);
	const formats: readonly OutputFormat[] = animated ? ['webp'] : settings.formats;
	const variants: PlannedVariant[] = [];
	for (const format of formats)
		for (const width of widths)
			variants.push({ width, format, name: `${base}-${width}.${EXT[format]}` });
	const ph = settings.placeholder
		? await limited(() => placeholder_of(bytes, settings.ops, size))
		: undefined;
	const plan: Plan = {
		id,
		width: size.width,
		height: size.height,
		animated,
		...(ph ? { ph } : {}),
		variants
	};
	plans.set(id, plan);
	return plan;
}

/** One encode per variant file at a time: callers of the same file share it. */
const writes = flights.keyed<{
	out: string;
	file: string;
	plan: Plan;
	variant: PlannedVariant;
	settings: Settings;
}>()({
	key: ['out'],
	ignore: {
		file: 'the out path names the file through the plan id',
		plan: 'the out path holds the plan id',
		variant: 'the out path holds the variant name',
		settings: 'the out path holds the plan id, a hash of the settings'
	},
	keep: 0,
	run: ({ out, file, plan, variant, settings }) =>
		limited(async () => {
			if (fs.existsSync(out)) return out;
			const bytes = fs.readFileSync(file);
			let data: Buffer;
			if (variant.format === 'svg') data = bytes;
			else {
				const height = Math.round((variant.width * plan.height) / plan.width);
				let img = pipeline(bytes, settings.ops, plan.animated, variant.width, height);
				const q = settings.quality;
				if (variant.format === 'avif') img = img.avif({ quality: q ?? 60, effort: 4 });
				else if (variant.format === 'webp')
					img = img.webp({ quality: q ?? 80, effort: 4, ...(plan.animated ? { loop: 0 } : {}) });
				else if (variant.format === 'jpeg') img = img.jpeg({ quality: q ?? 80, mozjpeg: true });
				else img = img.png({ compressionLevel: 9, ...(q !== undefined ? { quality: q } : {}) });
				data = await img.toBuffer();
			}
			fs.mkdirSync(path.dirname(out), { recursive: true });
			// written beside, then renamed: a reader never sees half a file
			const tmp = `${out}.${process.pid}.tmp`;
			fs.writeFileSync(tmp, data);
			fs.renameSync(tmp, out);
			return out;
		})
});

/** Make sure a variant's file exists (encoding it if needed); its path. */
export async function write_variant(
	file: string,
	plan: Plan,
	variant: PlannedVariant,
	settings: Settings
): Promise<string> {
	const out = variant_path(plan.id, variant.name);
	if (fs.existsSync(out)) return out;
	const done = await writes.get({ out, file, plan, variant, settings });
	if (done === STALE)
		throw new Error(`the encode of ${variant.name} was dropped before it finished`);
	return done;
}
