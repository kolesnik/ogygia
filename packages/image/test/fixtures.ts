/** Test images, made with sharp into a temp folder (no binary files in the repo). */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';

/** A folder of images: a wide photo-like JPEG, a transparent PNG, a small PNG, an animated GIF and
 *  an SVG. */
export async function make_images(): Promise<{
	dir: string;
	jpg: string;
	alpha: string;
	small: string;
	gif: string;
	svg: string;
	rotated: string;
}> {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-test-'));
	const jpg = path.join(dir, 'Harbor Dusk.jpg');
	const w = 2400;
	const h = 1600;
	const raw = Buffer.alloc(w * h * 3);
	for (let y = 0; y < h; y++)
		for (let x = 0; x < w; x++) {
			const i = (y * w + x) * 3;
			raw[i] = (x * 255) / w;
			raw[i + 1] = (y * 255) / h;
			raw[i + 2] = 128;
		}
	await sharp(raw, { raw: { width: w, height: h, channels: 3 } })
		.jpeg()
		.toFile(jpg);

	const alpha = path.join(dir, 'logo.png');
	await sharp({
		create: { width: 300, height: 200, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.5 } }
	})
		.png()
		.toFile(alpha);

	const small = path.join(dir, 'icon.png');
	await sharp({
		create: { width: 400, height: 400, channels: 3, background: { r: 10, g: 120, b: 200 } }
	})
		.png()
		.toFile(small);

	// three frames stacked: sharp writes them as an animated GIF
	const gif = path.join(dir, 'spin.gif');
	const fw = 320;
	const fh = 240;
	const frames = Buffer.alloc(fw * fh * 3 * 4);
	for (let f = 0; f < 3; f++)
		for (let i = 0; i < fw * fh; i++) frames[(f * fw * fh + i) * 4 + f] = 255;
	for (let i = 3; i < frames.length; i += 4) frames[i] = 255;
	await sharp(frames, { raw: { width: fw, height: fh * 3, channels: 4, pageHeight: fh } as never })
		.gif({ loop: 0, delay: [100, 100, 100] })
		.toFile(gif);

	const svg = path.join(dir, 'mark.svg');
	fs.writeFileSync(
		svg,
		'<svg xmlns="http://www.w3.org/2000/svg" width="120" height="60"><rect width="120" height="60" fill="teal"/></svg>'
	);

	// stored 300×200, EXIF orientation 6: shown 200×300
	const rotated = path.join(dir, 'portrait.jpg');
	await sharp({ create: { width: 300, height: 200, channels: 3, background: '#888' } })
		.jpeg()
		.withMetadata({ orientation: 6 })
		.toFile(rotated);

	return { dir, jpg, alpha, small, gif, svg, rotated };
}
