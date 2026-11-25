// The build's end: every file the build makes (a warmed preset's, a prerendered page's) is written
// under the app folder by its recipe, and each prerendered page's marked URLs point at them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { beforeAll, expect, test, vi } from 'vitest';
import type { RenderConfig } from '../src/config.ts';
import { note_built } from '../src/store.ts';
import { handoff_for, write_built } from '../src/vite/build-files.ts';
import { make_images } from './fixtures.ts';

vi.hoisted(() => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
});

const CFG: RenderConfig = {
	formats: ['avif', 'webp'],
	breakpoints: [320, 640],
	presets: { thumb: { width: 100, aspect: '1/1', formats: ['webp'] } },
	paths: { base: '', assets: '', app_dir: '_app' },
	warmed: true
};

let jpg = '';
beforeAll(async () => {
	jpg = (await make_images()).jpg;
});

function output(page: string): string {
	const out = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-out-'));
	fs.mkdirSync(path.join(out, 'client', '_app', 'immutable', 'assets'), { recursive: true });
	fs.copyFileSync(jpg, path.join(out, 'client', '_app', 'immutable', 'assets', 'h.Ab12.jpg'));
	fs.mkdirSync(path.join(out, 'prerendered', 'pages'), { recursive: true });
	fs.writeFileSync(path.join(out, 'prerendered', 'pages', 'index.html'), page);
	return out;
}

test("a prerendered page's files are written under the app folder, and its marked URLs name them", async () => {
	const handoff = handoff_for(true);
	note_built(handoff.minted, 'h1-64x43/_app/immutable/assets/h.Ab12.jpg.webp');
	const marked = `${handoff.mark}/_app/immutable/og/h1-64x43.webp`;
	const out = output(`<img src="${marked}" style="background:url(${marked})">`);
	await write_built(handoff, CFG, [], out);
	const file = path.join(out, 'client', '_app', 'immutable', 'og', 'h1-64x43.webp');
	const meta = await sharp(fs.readFileSync(file)).metadata();
	expect([meta.format, meta.width, meta.height]).toEqual(['webp', 64, 43]);
	expect(fs.readFileSync(path.join(out, 'prerendered', 'pages', 'index.html'), 'utf8')).toBe(
		'<img src="/_app/immutable/og/h1-64x43.webp" style="background:url(/_app/immutable/og/h1-64x43.webp)">'
	);
});

test("a warmed preset's files are written under the app folder by their recipe", async () => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
	const handoff = handoff_for(true);
	const out = output('<p>no images</p>');
	const desc = { id: 'w1', width: 2400, height: 1600, format: 'jpeg' as const };
	await write_built(handoff, CFG, [{ file: jpg, desc, presets: ['thumb'] }], out);
	const made = fs.readdirSync(path.join(out, 'client', '_app', 'immutable', 'og')).sort();
	expect(made).toEqual(['w1-100x100.webp', 'w1-200x200.webp']);
});

test('a page that changed a marked URL before writing it (escaped it) fails the build with a code', async () => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
	const handoff = handoff_for(true);
	note_built(handoff.minted, 'h1-64x43/_app/immutable/assets/h.Ab12.jpg.webp');
	const marked = `${handoff.mark}/_app/immutable/og/h1-64x43.webp`;
	const out = output(`<a href="/share?image=${encodeURIComponent(marked)}">share</a>`);
	await expect(write_built(handoff, CFG, [], out)).rejects.toMatchObject({
		code: 'image_mark_left'
	});
});
