import { describe, expect, test } from 'vitest';
import { lay_out } from '../src/layout.ts';
import type { ImageDescriptor, ImageFormat } from '../src/descriptor.ts';

const WIDTHS = [640, 960, 1280, 1600, 2048];

function image(formats: ImageFormat[] = ['avif', 'webp'], widths = WIDTHS): ImageDescriptor {
	return {
		id: 'x',
		width: 2400,
		height: 1600,
		variants: formats.flatMap((format) =>
			widths.map((width) => ({ src: `/i-${width}.${format}`, format, width }))
		)
	};
}

describe('lay_out', () => {
	test('constrained with a width offers the widths under 2× and the first at or above it', () => {
		const laid = lay_out(image(), { width: 600 });
		expect(laid.width).toBe(600);
		expect(laid.height).toBe(400);
		expect(laid.sizes).toBe('(min-width: 600px) 600px, 100vw');
		expect(laid.sources).toEqual([
			{ type: 'image/avif', srcset: '/i-640.avif 640w, /i-960.avif 960w, /i-1280.avif 1280w' }
		]);
		expect(laid.srcset).toBe('/i-640.webp 640w, /i-960.webp 960w, /i-1280.webp 1280w');
		expect(laid.src).toBe('/i-640.webp');
	});

	test('constrained never shows a raster wider than its pixels', () => {
		const laid = lay_out(image(), { width: 4000 });
		expect(laid.width).toBe(2400);
		expect(laid.height).toBe(1600);
	});

	test('constrained with no width is the intrinsic width', () => {
		const laid = lay_out(image());
		expect(laid.width).toBe(2400);
		expect(laid.sizes).toBe('(min-width: 2400px) 2400px, 100vw');
	});

	test('fullWidth offers every width at 100vw', () => {
		const laid = lay_out(image(), { layout: 'fullWidth' });
		expect(laid.sizes).toBe('100vw');
		expect(laid.srcset?.split(', ')).toHaveLength(5);
	});

	test('fixed offers 1× and 2× density candidates and no sizes', () => {
		const laid = lay_out(image(), { layout: 'fixed', width: 48 });
		expect(laid.width).toBe(48);
		expect(laid.height).toBe(32);
		expect(laid.sizes).toBeUndefined();
		expect(laid.srcset).toBe('/i-640.webp 1x');
	});

	test('fixed at a width with distinct 1× and 2× variants names both', () => {
		const laid = lay_out(image(), { layout: 'fixed', width: 700 });
		expect(laid.srcset).toBe('/i-960.webp 1x, /i-1600.webp 2x');
	});

	test('a width and a height crop to that box', () => {
		const laid = lay_out(image(), { width: 300, height: 300 });
		expect([laid.width, laid.height, laid.cover]).toEqual([300, 300, true]);
	});

	test('a cover crop picks candidates by the width that covers the box, not the box width', () => {
		// a 3:2 image cropped to 400×400 is drawn 600 wide: the source must be that wide
		const laid = lay_out(image(), { width: 400, height: 400 });
		expect(laid.sizes).toBe('(min-width: 400px) 600px, 150vw');
		expect(laid.srcset).toBe('/i-640.webp 640w, /i-960.webp 960w, /i-1280.webp 1280w');
		expect(laid.src).toBe('/i-640.webp');
		expect(laid.preload.href).toBe('/i-640.avif');
	});

	test('a cover crop wider than the image is covered by the box width itself', () => {
		const laid = lay_out(image(), { width: 600, height: 100 });
		expect(laid.sizes).toBe('(min-width: 600px) 600px, 100vw');
	});

	test('a fixed cover crop offers 1× and 2× of the covering width', () => {
		const laid = lay_out(image(), { layout: 'fixed', width: 400, height: 400 });
		expect(laid.srcset).toBe('/i-640.webp 1x, /i-1280.webp 2x');
	});

	test('a height alone keeps the aspect ratio', () => {
		const laid = lay_out(image(), { height: 200 });
		expect([laid.width, laid.height]).toEqual([300, 200]);
	});

	test('one format renders a plain img: no sources', () => {
		const laid = lay_out(image(['webp']), { width: 600 });
		expect(laid.sources).toEqual([]);
	});

	test('an authored sizes replaces the derived one', () => {
		expect(lay_out(image(), { sizes: '50vw' }).sizes).toBe('50vw');
	});

	test('an SVG has no srcset and no sizes', () => {
		const svg: ImageDescriptor = {
			id: 's',
			width: 120,
			height: 60,
			variants: [{ src: '/m.svg', format: 'svg', width: 120 }]
		};
		const laid = lay_out(svg, { width: 240 });
		expect([laid.src, laid.srcset, laid.sizes, laid.width]).toEqual([
			'/m.svg',
			undefined,
			undefined,
			240
		]);
	});

	test('the preload names the best format', () => {
		const laid = lay_out(image(), { layout: 'fullWidth' });
		expect(laid.preload.type).toBe('image/avif');
		expect(laid.preload.srcset).toContain('.avif 2048w');
	});
});
