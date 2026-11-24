// @ogygia/image against a real Kit app: macro images on `/`, a markdown blog on `/blog/[slug]`. The
// same specs run in three modes (playwright.config.ts): built with adapter-node and served, every page
// prerendered with adapter-static and served as plain files (no server at all), and the dev server.
// `pnpm --filter @ogygia/image e2e`.
import type { APIRequestContext, Locator, Page } from '@playwright/test';
import sharp from 'sharp';
import { test, expect } from '@ogygia/tooling/e2e';

const MODE = process.env.IMAGE_E2E_MODE ?? 'node';
const PAGES = ['/', '/blog/first-post', '/blog/second-post', '/blog/third-post'];
const IMAGE_URL_RE = /\/__ogygia__\/image\/[^\s",]+/g;

/** Scroll every lazy image into view, then wait until each has decoded pixels. */
async function every_image_loads(page: Page): Promise<void> {
	const imgs = page.locator('img');
	const n = await imgs.count();
	expect(n).toBeGreaterThan(0);
	for (let i = 0; i < n; i++) {
		const img = imgs.nth(i);
		await img.scrollIntoViewIfNeeded();
		await expect
			.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0), {
				message: `image ${i} (${await img.getAttribute('alt')}) loads`
			})
			.toBe(true);
	}
}

async function attrs(img: Locator): Promise<Record<string, string | null>> {
	return img.evaluate((el: HTMLImageElement) => {
		const out: Record<string, string | null> = {};
		for (const name of ['src', 'srcset', 'sizes', 'width', 'height', 'loading', 'fetchpriority'])
			out[name] = el.getAttribute(name);
		out.background = el.style.backgroundImage || null;
		out.transition = el.style.viewTransitionName || null;
		out.picture = el.parentElement?.tagName === 'PICTURE' ? 'yes' : null;
		out.avif =
			el.parentElement?.querySelector('source[type="image/avif"]')?.getAttribute('srcset') ?? null;
		return out;
	});
}

/** The URLs of a srcset, in order. */
function urls(srcset: string | null): string[] {
	return (srcset ?? '')
		.split(', ')
		.map((c) => c.split(' ')[0]!)
		.filter(Boolean);
}

/** One file's bytes and decoded size. */
async function fetch_file(
	request: APIRequestContext,
	url: string
): Promise<{ type: string; bytes: Buffer; width: number; height: number; pages: number }> {
	const res = await request.get(url);
	expect(res.status(), url).toBe(200);
	const bytes = await res.body();
	const meta = await sharp(bytes, { animated: true }).metadata();
	return {
		type: res.headers()['content-type'] ?? '',
		bytes,
		width: meta.width,
		height: meta.pageHeight ?? meta.height,
		pages: meta.pages ?? 1
	};
}

test.describe('macro images (/)', () => {
	test('a photo renders a <picture> with an AVIF source, a srcset, sizes and its box', async ({
		page
	}) => {
		await page.goto('/');
		const a = await attrs(page.locator('#portrait'));
		expect(a.picture).toBe('yes');
		expect(a.avif).toMatch(/\.avif 400w, .+\.avif 800w$/);
		expect(a.srcset).toMatch(/\.webp 400w, .+\.webp 800w$/);
		expect(a.sizes).toBe('(min-width: 400px) 400px, 100vw');
		expect([a.width, a.height]).toEqual(['400', '500']);
		expect(a.loading).toBe('lazy');
	});

	test('an opaque lazy image paints a placeholder; a transparent one does not', async ({
		page
	}) => {
		await page.goto('/');
		expect((await attrs(page.locator('#portrait'))).background).toMatch(
			/^url\("?data:image\/webp;base64,/
		);
		expect((await attrs(page.locator('#badge'))).background).toBeNull();
		expect((await attrs(page.locator('#logo'))).background).toBeNull();
	});

	test('a placeholder costs the page at most 400 bytes of HTML', async ({ request }) => {
		const html = await (await request.get('/')).text();
		const found = html.match(/data:image\/[a-z]+;base64,[\w+/=]+/g) ?? [];
		expect(found.length).toBeGreaterThan(0);
		for (const url of found) expect(url.length).toBeLessThanOrEqual(400);
	});

	test('the cover preset is the priority hero: preloaded from the head and fetched first', async ({
		page
	}) => {
		await page.goto('/');
		const hero = await attrs(page.locator('#hero'));
		expect(hero.fetchpriority).toBe('high');
		expect(hero.loading).toBe('eager');
		expect(hero.sizes).toBe('100vw');
		const preload = page.locator('head link[rel="preload"][as="image"]');
		await expect(preload).toHaveCount(1);
		expect(await preload.getAttribute('imagesrcset')).toBe(hero.avif);
		expect(await preload.getAttribute('fetchpriority')).toBe('high');
	});

	test('a thumb preset and a cover preset of the same source are different crops', async ({
		page,
		request
	}) => {
		await page.goto('/');
		const thumb = await attrs(page.locator('#thumb'));
		const cover = await attrs(page.locator('#hero'));
		expect([thumb.width, thumb.height]).toEqual(['200', '200']);
		for (const url of [...urls(thumb.avif), ...urls(thumb.srcset)]) {
			const f = await fetch_file(request, url);
			expect(f.width, url).toBe(f.height);
		}
		for (const url of [...urls(cover.avif), ...urls(cover.srcset)]) {
			const f = await fetch_file(request, url);
			expect(Math.abs(f.width / f.height - 16 / 9), url).toBeLessThan(0.01);
		}
	});

	test('a fixed 48px avatar never downloads a file wider than 96px', async ({ page, request }) => {
		await page.goto('/');
		const avatar = page.locator('#avatar');
		const a = await attrs(avatar);
		expect([a.width, a.height]).toEqual(['48', '48']);
		expect(a.srcset).toMatch(/ 1x, .+ 2x$/);
		for (const url of [...urls(a.avif), ...urls(a.srcset), a.src!]) {
			const f = await fetch_file(request, url);
			expect(f.width, url).toBeLessThanOrEqual(96);
		}
		await expect
			.poll(() => avatar.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
			.toBe(true);
		expect(await avatar.evaluate((el: HTMLImageElement) => el.naturalWidth)).toBeLessThanOrEqual(
			96
		);
	});

	test('a glob gallery renders each file', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('img.gallery')).toHaveCount(3);
	});

	test('a 300px gallery image on a 1x screen downloads a file between 300 and 480 pixels wide', async ({
		page
	}) => {
		await page.goto('/');
		const first = page.locator('img.gallery').first();
		await first.scrollIntoViewIfNeeded();
		await expect
			.poll(() => first.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
			.toBe(true);
		const natural = await first.evaluate((el: HTMLImageElement) => el.naturalWidth);
		expect(natural).toBeGreaterThanOrEqual(300);
		expect(natural).toBeLessThanOrEqual(480);
	});

	test('a width and height crop keeps its box after the image loads, from a file cut to that box', async ({
		page
	}) => {
		await page.goto('/');
		const crop = page.locator('#crop');
		await crop.scrollIntoViewIfNeeded();
		await expect
			.poll(() => crop.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
			.toBe(true);
		const box = await crop.boundingBox();
		expect([Math.round(box!.width), Math.round(box!.height)]).toEqual([400, 400]);
		const natural = await crop.evaluate((el: HTMLImageElement) => [
			el.naturalWidth,
			el.naturalHeight
		]);
		expect(natural[0]).toBe(natural[1]);
		expect(natural[0]).toBeGreaterThanOrEqual(400);
	});

	test('an SVG passes through as its original file, with no <picture>', async ({ page }) => {
		await page.goto('/');
		const logo = await attrs(page.locator('#logo'));
		expect(logo.picture).toBeNull();
		expect(logo.src).toMatch(/\.svg(?:\?no-inline)?$/);
		expect(logo.srcset).toBeNull();
		expect([logo.width, logo.height]).toEqual(['120', '40']);
	});

	test('an animated GIF is served as an animated WebP', async ({ page, request }) => {
		await page.goto('/');
		const spinner = await attrs(page.locator('#spinner'));
		expect(spinner.picture).toBeNull();
		expect(spinner.src).toMatch(/\.webp$/);
		const f = await fetch_file(request, spinner.src!);
		expect(f.type).toBe('image/webp');
		expect(f.bytes.includes(Buffer.from('ANIM'))).toBe(true);
		expect(f.pages).toBe(3);
	});

	test('no image carries an inline event handler, so a strict CSP has nothing to block', async ({
		request
	}) => {
		for (const url of ['/', '/blog/first-post']) {
			const html = await (await request.get(url)).text();
			const tags = html.match(/<(?:img|picture|source)\b[^>]*>/g) ?? [];
			expect(tags.length).toBeGreaterThan(0);
			for (const tag of tags) expect(tag).not.toMatch(/\son[a-z]+=/i);
		}
	});

	test('the named attributes reach the <img>', async ({ page }) => {
		await page.goto('/');
		await expect(page.locator('img#portrait')).toHaveAttribute('title', 'Tall');
	});

	test('every image on the page really loads', async ({ page }) => {
		await page.goto('/');
		await every_image_loads(page);
	});
});

test.describe('markdown images (/blog/[slug])', () => {
	test('the frontmatter cover renders through <Img> with the cover preset', async ({ page }) => {
		await page.goto('/blog/first-post');
		const cover = await attrs(page.locator('#cover'));
		expect(cover.picture).toBe('yes');
		expect(cover.avif).toMatch(/\/cover(?:\.[\w-]+)?\.jpg\.avif \d+w/);
		expect([cover.width, cover.height]).toEqual(['1120', '630']);
		expect(cover.fetchpriority).toBe('high');
		await expect(page.locator('head link[rel="preload"][as="image"]')).toHaveCount(1);
	});

	test('a co-located body image renders through <Img> with the prose preset', async ({ page }) => {
		await page.goto('/blog/first-post');
		const harbor = await attrs(page.getByAltText('A harbor in the evening'));
		expect(harbor.picture).toBe('yes');
		expect(harbor.avif).toMatch(/-720x480\/[^ ]*harbor[^ ]*\.avif 720w/);
		expect(harbor.sizes).toBe('(min-width: 720px) 720px, 100vw');
		expect([harbor.width, harbor.height]).toEqual(['720', '480']);
		expect(harbor.loading).toBe('lazy');
		expect(harbor.background).toMatch(/^url\("?data:image\/webp;base64,/);
	});

	test('a GIF in the body becomes an animated WebP', async ({ page, request }) => {
		await page.goto('/blog/first-post');
		const gif = await attrs(page.getByAltText('A moving dot'));
		expect(gif.src).toMatch(/\.webp$/);
		const f = await fetch_file(request, gif.src!);
		expect(f.type).toBe('image/webp');
		expect(f.bytes.includes(Buffer.from('ANIM'))).toBe(true);
	});

	test("an image from another post's folder (../) resolves, title kept", async ({ page }) => {
		await page.goto('/blog/second-post');
		const img = page.getByAltText('The same harbor');
		expect(await img.getAttribute('title')).toBe('Borrowed');
		expect((await attrs(img)).avif).toMatch(/harbor[^ ]*\.avif 720w/);
		await expect(page.locator('#cover')).toHaveAttribute('height', '630');
	});

	test('images whose names hold a space or an accent resolve and load', async ({ page }) => {
		await page.goto('/blog/third-post');
		for (const alt of ['A spaced name', 'A name with an accent']) {
			const a = await attrs(page.getByAltText(alt));
			expect(a.picture).toBe('yes');
			expect(a.avif).toMatch(/\.avif 500w/);
		}
		await expect(page.locator('#cover')).toHaveAttribute('height', '630');
	});

	for (const slug of ['first-post', 'second-post', 'third-post'])
		test(`every image on /blog/${slug} really loads`, async ({ page }) => {
			await page.goto(`/blog/${slug}`);
			await every_image_loads(page);
		});
});

test.describe('the image endpoint', () => {
	test('every file URL every page names answers 200 with its type', async ({ request }) => {
		const seen = new Set<string>();
		for (const p of PAGES) {
			const html = await (await request.get(p)).text();
			for (const url of html.match(IMAGE_URL_RE) ?? []) seen.add(url);
		}
		expect(seen.size).toBeGreaterThan(40);
		for (const url of seen) {
			const res = await request.get(url);
			expect(res.status(), url).toBe(200);
			const ext = /\.(avif|webp)$/.exec(url)?.[1];
			expect(res.headers()['content-type'], url).toBe(`image/${ext}`);
		}
	});

	test('a file URL whose recipe was changed, or whose signature was, is refused', async ({
		request
	}) => {
		const html = await (await request.get('/')).text();
		const url = html.match(IMAGE_URL_RE)!.find((u) => /-48x48\//.test(u))!;
		const wider = url.replace('-48x48/', '-2000x2000/');
		const sig = /\/image\/([0-9a-f]{32})\//.exec(url)![1]!;
		const resigned = url.replace(sig, sig.replace(/^./, (c) => (c === '0' ? '1' : '0')));
		for (const bad of [wider, resigned, url.replace(`/${sig}/`, '/')]) {
			const res = await request.get(bad);
			expect(res.status(), bad).toBe(MODE === 'static' ? 404 : 403);
		}
		expect((await request.get(url)).status()).toBe(200);
	});

	test('a file is sent to be kept forever', async ({ request }) => {
		test.skip(MODE === 'static', 'a static host sends its own headers');
		const html = await (await request.get('/')).text();
		const res = await request.get(html.match(IMAGE_URL_RE)![0]!);
		expect(res.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
	});
});

test.describe('with the runtime', () => {
	test('an <Img> inside a hydrated island renders the same, loads, and the island still works', async ({
		page
	}) => {
		const errors: string[] = [];
		page.on('pageerror', (e) => errors.push(e.message));
		page.on('console', (m) => {
			if (m.type() === 'error') errors.push(m.text());
		});
		await page.goto('/');
		const img = page.locator('#island-img');
		const before = await attrs(img);
		expect(before.srcset).toMatch(/\.webp 1x/);
		const button = page.locator('#island-count');
		await expect(async () => {
			await button.click();
			await expect(button).not.toHaveText('0', { timeout: 200 });
		}).toPass();
		expect(await attrs(img)).toEqual(before);
		await expect
			.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
			.toBe(true);
		expect(errors).toEqual([]);
	});

	test("a client-side navigation swaps the head's preload for the new page's priority image", async ({
		page
	}) => {
		await page.goto('/');
		const preload = page.locator('head link[rel="preload"][as="image"]');
		await expect(preload).toHaveCount(1);
		const home = await preload.getAttribute('imagesrcset');
		await page.evaluate(() => ((window as { __same_page?: boolean }).__same_page = true));
		await page.locator('#to-post').click();
		await expect(page.locator('#cover')).toBeVisible();
		expect(await page.evaluate(() => (window as { __same_page?: boolean }).__same_page)).toBe(true);
		await expect(preload).toHaveCount(1);
		const post = await preload.getAttribute('imagesrcset');
		expect(post).not.toBe(home);
		expect(post).toBe((await attrs(page.locator('#cover'))).avif);
		const cover = page.locator('#cover');
		await expect
			.poll(() => cover.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
			.toBe(true);
	});
});
