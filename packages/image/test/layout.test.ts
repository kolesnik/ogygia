import { describe, expect, test } from 'vitest';
import { lay_out } from '../src/layout.ts';
import type { RenderConfig } from '../src/config.ts';
import type { ImageDescriptor } from '../src/descriptor.ts';
import type { Recipe } from '../src/recipe.ts';

const CFG: RenderConfig = {
	formats: ['avif', 'webp'],
	breakpoints: [640, 960, 1280, 1600, 2048],
	presets: {}
};

function image(over: Partial<ImageDescriptor> = {}): ImageDescriptor {
	return { id: 'x', src: '/a/photo.jpg', width: 2400, height: 1600, format: 'jpeg', ...over };
}

/** A URL that spells the recipe out, so a test reads what was asked for. */
const url = (r: Recipe): string =>
	`/${r.width}x${r.height}${r.position ? `-${r.position}` : ''}${r.quality ? `-q${r.quality}` : ''}.${r.format}`;

describe('lay_out', () => {
	test('constrained with a width offers its 1× and 2× and the breakpoints under 2×', () => {
		const laid = lay_out(image(), { width: 600 }, CFG, url);
		expect(laid.width).toBe(600);
		expect(laid.height).toBe(400);
		expect(laid.sizes).toBe('(min-width: 600px) 600px, 100vw');
		expect(laid.sources).toEqual([
			{
				type: 'image/avif',
				srcset:
					'/600x400.avif 600w, /640x427.avif 640w, /960x640.avif 960w, /1200x800.avif 1200w'
			}
		]);
		expect(laid.srcset).toBe(
			'/600x400.webp 600w, /640x427.webp 640w, /960x640.webp 960w, /1200x800.webp 1200w'
		);
		expect(laid.src).toBe('/600x400.webp');
	});

	test('constrained never asks for a raster wider than its pixels', () => {
		const laid = lay_out(image(), { width: 4000 }, CFG, url);
		expect([laid.width, laid.height]).toEqual([2400, 1600]);
		expect(laid.srcset?.split(', ').at(-1)).toBe('/2400x1600.webp 2400w');
	});

	test('constrained with no width is the intrinsic width', () => {
		const laid = lay_out(image(), {}, CFG, url);
		expect(laid.width).toBe(2400);
		expect(laid.sizes).toBe('(min-width: 2400px) 2400px, 100vw');
	});

	test('fullWidth offers every breakpoint at 100vw', () => {
		const laid = lay_out(image(), { layout: 'fullWidth' }, CFG, url);
		expect(laid.sizes).toBe('100vw');
		expect(laid.srcset?.split(', ')).toHaveLength(5);
	});

	test('fixed asks for exactly 1× and 2× of its box, and no sizes', () => {
		const laid = lay_out(image(), { layout: 'fixed', width: 48 }, CFG, url);
		expect([laid.width, laid.height]).toEqual([48, 32]);
		expect(laid.sizes).toBeUndefined();
		expect(laid.srcset).toBe('/48x32.webp 1x, /96x64.webp 2x');
	});

	test('a fixed square avatar from a wide photo is cut square, never wider than 2× its box', () => {
		const laid = lay_out(image(), { layout: 'fixed', width: 48, height: 48 }, CFG, url);
		expect(laid.srcset).toBe('/48x48.webp 1x, /96x96.webp 2x');
		expect(laid.cover).toBe(true);
	});

	test('a width and a height crop the files to that box', () => {
		const laid = lay_out(image(), { width: 400, height: 400 }, CFG, url);
		expect([laid.width, laid.height, laid.cover]).toEqual([400, 400, true]);
		expect(laid.sizes).toBe('(min-width: 400px) 400px, 100vw');
		expect(laid.srcset).toBe('/400x400.webp 400w, /640x640.webp 640w, /800x800.webp 800w');
		expect(laid.preload.href).toBe('/400x400.avif');
	});

	test('an aspect crops every file to that shape, no wider than the source covers', () => {
		const laid = lay_out(image(), { layout: 'fullWidth', aspect: '1/1' }, CFG, url);
		expect([laid.width, laid.height]).toEqual([1600, 1600]);
		expect(laid.srcset).toBe(
			'/640x640.webp 640w, /960x960.webp 960w, /1280x1280.webp 1280w, /1600x1600.webp 1600w'
		);
	});

	test('a crop names where it keeps; the centre is the default and goes unsaid', () => {
		expect(lay_out(image(), { width: 300, aspect: 1, position: 'top' }, CFG, url).src).toBe(
			'/300x300-top.webp'
		);
		expect(lay_out(image(), { width: 300, aspect: 1, position: 'center' }, CFG, url).src).toBe(
			'/300x300.webp'
		);
	});

	test('a position on an image whose shape is kept changes nothing', () => {
		expect(lay_out(image(), { width: 300, position: 'top' }, CFG, url).src).toBe('/300x200.webp');
	});

	test('a height alone keeps the aspect ratio', () => {
		const laid = lay_out(image(), { height: 200 }, CFG, url);
		expect([laid.width, laid.height]).toEqual([300, 200]);
	});

	test('one format renders a plain img: no sources', () => {
		const laid = lay_out(image(), { width: 600, formats: ['webp'] }, CFG, url);
		expect(laid.sources).toEqual([]);
	});

	test('an animated source is offered as WebP only', () => {
		const laid = lay_out(image({ animated: true, format: 'gif' }), { width: 600 }, CFG, url);
		expect(laid.sources).toEqual([]);
		expect(laid.src).toBe('/600x400.webp');
	});

	test('quality: the request over the source over the plugin', () => {
		const q = { ...CFG, quality: 50 };
		expect(lay_out(image(), { width: 300 }, q, url).src).toBe('/300x200-q50.webp');
		expect(lay_out(image({ quality: 60 }), { width: 300 }, q, url).src).toBe('/300x200-q60.webp');
		expect(lay_out(image({ quality: 60 }), { width: 300, quality: 70 }, q, url).src).toBe(
			'/300x200-q70.webp'
		);
	});

	test('an authored sizes replaces the derived one', () => {
		expect(lay_out(image(), { sizes: '50vw' }, CFG, url).sizes).toBe('50vw');
	});

	test('an SVG is its own file: no srcset, no sizes, no recipe', () => {
		const svg = image({ id: 's', src: '/m.svg', width: 120, height: 60, format: 'svg' });
		const laid = lay_out(svg, { width: 240 }, CFG, () => {
			throw new Error('an SVG asks for no file');
		});
		expect([laid.src, laid.srcset, laid.sizes, laid.width]).toEqual([
			'/m.svg',
			undefined,
			undefined,
			240
		]);
	});

	test('the preload names the best format', () => {
		const laid = lay_out(image(), { layout: 'fullWidth' }, CFG, url);
		expect(laid.preload.type).toBe('image/avif');
		expect(laid.preload.srcset).toContain('.avif 2048w');
	});
});
