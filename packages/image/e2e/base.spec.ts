// The fixture app under `paths.base` (`/base`), every page prerendered and served as plain files
// there (`IMAGE_E2E_MODE=base`): every file a page names sits under the base, and is a file the build
// wrote, whether the crawler asked for it, a CSS background named it, or a preset was warmed.
import { test, expect } from '@ogygia/tooling/e2e';

const PAGES = ['/base/', '/base/blog/first-post', '/base/blog/third-post', '/base/island'];
const FILE_RE = /\/[^\s",()]*(?:__ogygia__\/i|_app\/immutable\/og)\/[^\s",)]+/g;

test('every image file each page names sits under the base, and loads as an image', async ({
	request
}) => {
	const seen = new Set<string>();
	for (const p of PAGES) {
		const res = await request.get(p);
		expect(res.status(), p).toBe(200);
		for (const url of (await res.text()).match(FILE_RE) ?? []) seen.add(url);
	}
	expect(seen.size).toBeGreaterThan(40);
	for (const url of seen) {
		expect(url, url).toMatch(/^\/base\/(?:__ogygia__\/i|_app\/immutable\/og)\//);
		const res = await request.get(url);
		expect(res.status(), url).toBe(200);
		expect(res.headers()['content-type'], url).toMatch(/^image\/(avif|webp)$/);
	}
});

test('the page loads every image, its CSS background and its warmed preset under the base', async ({
	page
}) => {
	await page.goto('/base/');
	const backdrop = await page
		.locator('#backdrop')
		.evaluate((el: HTMLElement) => el.style.backgroundImage);
	expect(backdrop).toMatch(/^url\("?\/base\/__ogygia__\/i\//);
	expect(await page.locator('#warmed').getAttribute('src')).toMatch(
		/^\/base\/_app\/immutable\/og\//
	);
	const imgs = page.locator('img');
	for (let i = 0; i < (await imgs.count()); i++) {
		const img = imgs.nth(i);
		await img.scrollIntoViewIfNeeded();
		await expect
			.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
			.toBe(true);
	}
});
