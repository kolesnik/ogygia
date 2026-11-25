// THE EARLY START OF THE LOAD WAKE'S CODE (packages/core/src/early-code.ts), in every engine. A
// csr=false page whose islands wake at load starts their code at first paint, before the runtime is
// in (the runtime is held back here, so whatever asks for island code before it lands is the early
// start), and never on a page that marks a critical resource: the hero the load scheduler's gate
// waits for keeps its bandwidth (load-scheduler.spec.ts, the 2026-10 field regression).
//
//   pnpm exec playwright test early-code
import type { Page, Route } from '@playwright/test';
import { test, check } from '@ogygia/tooling/e2e';
import { downloads, hear_downloads } from '@ogygia/tooling/e2e/downloads.ts';

const RUNTIME_RE = /\/og-runtime[^/]*\.js(?:\?|$)/;
const HERO = '**/lcp-hero.png';
const EARLY = 'link[rel="modulepreload"][data-ogygia-graph-preload="early"]';
const EARLY_BLOCK_RE =
	/<script type="application\/json" id="ogygia-early-code">[^<]*<\/script><script>\(function start_early_code[\s\S]*?<\/script>/;

/** Holds the runtime's file until `release()`; `released_at` is when it went on (page clock). */
function hold_runtime(page: Page) {
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	void page.route(RUNTIME_RE, async (route: Route) => {
		await gate;
		await route.continue();
	});
	return release;
}

function hold_hero(page: Page) {
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	void page.route(HERO, async (route: Route) => {
		await gate;
		await route.continue();
	});
	return release;
}

/** The files the page's early start carries (its data block), or null when it has none. */
async function early_files(page: Page): Promise<string[] | null> {
	return page.evaluate(() => {
		const data = document.getElementById('ogygia-early-code');
		return data
			? (JSON.parse(data.textContent || '[]') as string[]).map(
					(h) => new URL(h, document.baseURI).href
				)
			: null;
	});
}

const load_regions_hydrated = (page: Page) =>
	page.waitForFunction(
		() => {
			const load = [...document.querySelectorAll('ogygia-region[wake="load"][entry]')];
			return load.length > 0 && load.every((r) => r.hasAttribute('data-hydrated'));
		},
		null,
		{ timeout: 15_000 }
	);

test.describe('the early start of the load wake’s code', () => {
	test.beforeEach(({ page }) => hear_downloads(page));

	test('a page with no critical resource: its load code starts at first paint, before the runtime is in', async ({
		page
	}) => {
		const release = hold_runtime(page);
		await page.goto('/lcp/text', { waitUntil: 'commit' });
		await page.waitForSelector(EARLY, { state: 'attached', timeout: 10_000 });
		const files = await early_files(page);
		check('the page carries its load wake’s files', !!files && files.length > 0);
		const links = await page.$$eval(EARLY, (ls) =>
			ls.map((l) => ({ href: (l as HTMLLinkElement).href, p: l.getAttribute('fetchpriority') }))
		);
		check(
			'every early link is a low-priority modulepreload of one of those files',
			links.every((l) => l.p === 'low' && files!.includes(l.href)),
			JSON.stringify(links)
		);
		check(
			'the runtime is not in yet',
			await page.evaluate(() => !customElements.get('ogygia-region'))
		);
		release();
		await load_regions_hydrated(page);
	});

	test('old markup (no early start in it): the islands wake as before', async ({ page }) => {
		await page.route('**/lcp/text', async (route) => {
			const res = await route.fetch();
			const html = await res.text();
			check('the served page carried the early start', EARLY_BLOCK_RE.test(html));
			await route.fulfill({ response: res, body: html.replace(EARLY_BLOCK_RE, '') });
		});
		await page.goto('/lcp/text');
		await load_regions_hydrated(page);
		check('no early link', (await page.locator(EARLY).count()) === 0);
	});

	test('a page that marks its hero critical carries no early start; its island code waits for the hero', async ({
		page
	}) => {
		const release = hold_hero(page);
		await page.goto('/lcp/hero', { waitUntil: 'domcontentloaded' });
		check('no early start written', (await early_files(page)) === null);
		await page.waitForFunction(() => !!customElements.get('ogygia-region'));
		await page.waitForTimeout(800);
		check('no early link', (await page.locator(EARLY).count()) === 0);
		check(
			'held: no island hydrated',
			(await page.locator('ogygia-region[data-hydrated]').count()) === 0
		);
		release();
		await load_regions_hydrated(page);
	});

	test('a critical resource the server could not see: the early start stands down in the browser', async ({
		page
	}) => {
		await page.route('**/lcp/text', async (route) => {
			const res = await route.fetch();
			const html = (await res.text()).replace(
				/<body[^>]*>/,
				(b) =>
					`${b}<img data-injected src="/lcp-hero.png" fetchpriority="high" width="480" height="180" alt="">`
			);
			await route.fulfill({ response: res, body: html });
		});
		const release_hero = hold_hero(page);
		const release_runtime = hold_runtime(page);
		await page.goto('/lcp/text', { waitUntil: 'commit' });
		await page.waitForSelector('img[data-injected]', { state: 'attached' });
		await page.waitForTimeout(800);
		const files = await early_files(page);
		check('the server wrote the early start (it saw no hero)', !!files && files.length > 0);
		check('no early link while the hero is held', (await page.locator(EARLY).count()) === 0);
		release_runtime();
		await page.waitForFunction(() => !!customElements.get('ogygia-region'));
		await page.waitForTimeout(500);
		const asked = (await downloads(page)).filter((d) => files!.includes(d.name));
		check(
			'held: no island file requested (the runtime’s gate waits for the hero too)',
			asked.length === 0,
			JSON.stringify(asked.map((a) => a.name))
		);
		release_hero();
		await load_regions_hydrated(page);
		const hero_end = (await downloads(page)).find((d) => d.name.includes('lcp-hero.png'))?.end;
		const early_asked = (await downloads(page)).filter((d) => files!.includes(d.name));
		check(
			'every island file was asked for after the hero arrived',
			hero_end !== undefined && early_asked.every((d) => d.start >= hero_end - 1),
			JSON.stringify({ hero_end, starts: early_asked.map((d) => d.start) })
		);
		check('no early link at all', (await page.locator(EARLY).count()) === 0);
	});

	test('under a policy that allows inline scripts by hash only: the hash is sent, the script runs', async ({
		page
	}) => {
		await page.addInitScript(() => {
			(window as unknown as { __og_csp: string[] }).__og_csp = [];
			document.addEventListener('securitypolicyviolation', (e) =>
				(window as unknown as { __og_csp: string[] }).__og_csp.push(e.sample)
			);
		});
		const release = hold_runtime(page);
		const response = page.waitForResponse((r) => r.url().includes('/lcp/text?csp=1'));
		await page.goto('/lcp/text?csp=1', { waitUntil: 'commit' });
		const csp = (await (await response).allHeaders())['content-security-policy'] ?? '';
		check('the policy carries the script’s hash', /'sha256-[\w+/=]+'/.test(csp), csp);
		await page.waitForSelector(EARLY, { state: 'attached', timeout: 10_000 });
		const blocked = await page.evaluate(
			() => (window as unknown as { __og_csp: string[] }).__og_csp
		);
		check(
			'the early start was not blocked',
			!blocked.some((s) => s.includes('start_early_code')),
			JSON.stringify(blocked)
		);
		release();
		await load_regions_hydrated(page);
	});
});
