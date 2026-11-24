// @ogygia/image against a real Kit build: macro images on `/`, a markdown blog on `/blog/[slug]`.
// `pnpm --filter @ogygia/image e2e`.
import type { Locator, Page } from '@playwright/test';
import { test, expect } from '@ogygia/tooling/e2e';

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
		out.picture = el.parentElement?.tagName === 'PICTURE' ? 'yes' : null;
		out.avif =
			el.parentElement?.querySelector('source[type="image/avif"]')?.getAttribute('srcset') ?? null;
		return out;
	});
}

test.describe('macro images (/)', () => {
	test('a photo renders a <picture> with an AVIF source, a srcset, sizes and its box', async ({
		page
	}) => {
		await page.goto('/');
		const a = await attrs(page.locator('#portrait'));
		expect(a.picture).toBe('yes');
		expect(a.avif).toMatch(/\.avif 640w, .+\.avif 800w$/);
		expect(a.srcset).toMatch(/\.webp 640w, .+\.webp 800w$/);
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
		const urls = html.match(/data:image\/[a-z]+;base64,[\w+/=]+/g) ?? [];
		expect(urls.length).toBeGreaterThan(0);
		for (const url of urls) expect(url.length).toBeLessThanOrEqual(400);
	});

	test('the priority hero is preloaded from the head and fetched first', async ({ page }) => {
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

	test('a fixed avatar keeps its size; a glob gallery renders each file', async ({ page }) => {
		await page.goto('/');
		const avatar = await attrs(page.locator('#avatar'));
		expect([avatar.width, avatar.height]).toEqual(['48', '48']);
		expect(avatar.srcset).toMatch(/ 1x/);
		await expect(page.locator('img.gallery')).toHaveCount(3);
	});

	test('a 300px gallery image on a 1x screen downloads the 320px file, not a 600px one', async ({
		page
	}) => {
		await page.goto('/');
		const first = page.locator('img.gallery').first();
		await first.scrollIntoViewIfNeeded();
		await expect
			.poll(() => first.evaluate((el: HTMLImageElement) => el.currentSrc))
			.toMatch(/-320\.[\w-]+\.avif$/);
	});

	test('a width and height crop keeps its box after the image loads, from a source wide enough to cover it', async ({
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
		// 1800×1000 cropped to a 400 square is drawn 720 wide: a 1x screen needs at least that
		const src = await crop.evaluate((el: HTMLImageElement) => el.currentSrc);
		expect(Number(/-(\d+)\.[\w-]+\.avif$/.exec(src)?.[1])).toBeGreaterThanOrEqual(720);
	});

	test('an SVG passes through as one file, with no <picture>', async ({ page }) => {
		await page.goto('/');
		const logo = await attrs(page.locator('#logo'));
		expect(logo.picture).toBeNull();
		expect(logo.src).toMatch(/\.svg$/);
		expect([logo.width, logo.height]).toEqual(['120', '40']);
	});

	test('an animated GIF is served as an animated WebP', async ({ page, request }) => {
		await page.goto('/');
		const spinner = await attrs(page.locator('#spinner'));
		expect(spinner.picture).toBeNull();
		expect(spinner.src).toMatch(/\.webp$/);
		const res = await request.get(spinner.src!);
		expect(res.headers()['content-type']).toBe('image/webp');
		const bytes = await res.body();
		// an animated WebP carries an ANIM chunk
		expect(bytes.includes(Buffer.from('ANIM'))).toBe(true);
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
		await expect(page.locator('img.gallery')).toHaveCount(3);
	});

	test('every image on the page really loads', async ({ page }) => {
		await page.goto('/');
		await every_image_loads(page);
	});
});

test.describe('markdown images (/blog/[slug])', () => {
	test('the frontmatter cover renders through <Img> as the priority hero', async ({ page }) => {
		await page.goto('/blog/first-post');
		const cover = await attrs(page.locator('#cover'));
		expect(cover.picture).toBe('yes');
		expect(cover.avif).toMatch(/cover-\d+\.[\w-]+\.avif \d+w/);
		expect([cover.width, cover.height]).toEqual(['1200', '630']);
		expect(cover.fetchpriority).toBe('high');
		await expect(page.locator('head link[rel="preload"][as="image"]')).toHaveCount(1);
	});

	test('a co-located body image renders through <Img> at the prose width', async ({ page }) => {
		await page.goto('/blog/first-post');
		const harbor = await attrs(page.getByAltText('A harbor in the evening'));
		expect(harbor.picture).toBe('yes');
		expect(harbor.avif).toMatch(/harbor-720\.[\w-]+\.avif 720w/);
		expect(harbor.sizes).toBe('(min-width: 720px) 720px, 100vw');
		expect([harbor.width, harbor.height]).toEqual(['720', '480']);
		expect(harbor.loading).toBe('lazy');
		expect(harbor.background).toMatch(/^url\("?data:image\/webp;base64,/);
	});

	test('a GIF in the body becomes an animated WebP', async ({ page, request }) => {
		await page.goto('/blog/first-post');
		const gif = await attrs(page.getByAltText('A moving dot'));
		expect(gif.src).toMatch(/\.webp$/);
		const res = await request.get(gif.src!);
		expect(res.headers()['content-type']).toBe('image/webp');
		expect((await res.body()).includes(Buffer.from('ANIM'))).toBe(true);
	});

	test("an image from another post's folder (../) resolves, title kept", async ({ page }) => {
		await page.goto('/blog/second-post');
		const img = page.getByAltText('The same harbor');
		expect(await img.getAttribute('title')).toBe('Borrowed');
		expect((await attrs(img)).avif).toMatch(/harbor-720\.[\w-]+\.avif 720w/);
		await expect(page.locator('#cover')).toHaveAttribute('width', '1200');
	});

	test('images whose names hold a space or an accent resolve and load', async ({ page }) => {
		await page.goto('/blog/third-post');
		for (const alt of ['A spaced name', 'A name with an accent']) {
			const a = await attrs(page.getByAltText(alt));
			expect(a.picture).toBe('yes');
			expect(a.avif).toMatch(/\.avif 500w/);
		}
		await expect(page.locator('#cover')).toHaveAttribute('width', '1200');
	});

	for (const slug of ['first-post', 'second-post', 'third-post'])
		test(`every image on /blog/${slug} really loads`, async ({ page }) => {
			await page.goto(`/blog/${slug}`);
			await every_image_loads(page);
		});
});
