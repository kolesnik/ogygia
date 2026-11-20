// THE PLAINEST APP (apps/plain-islands): csr=false pages whose regions are islands only, no deferred
// hole, no lake, no held region, no router. Its build's feature word has no frames bit, so the region
// element's hole and live programs fold out of its boot (./_programs.ts, the leak gate's table). The
// palaestra has every feature, so without this app no e2e run boots a runtime built without them.
//
// Self-contained: builds apps/plain-islands with ogygia's rules on (the harness reads them at the end
// of each test), checks the boot's code, serves it, and wakes each island in a browser.
//
//   pnpm exec playwright test plain-islands

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page } from '@playwright/test';
import { test, expect } from '@ogygia/tooling/e2e';
import { build_app } from '@ogygia/tooling/e2e/build.ts';
import { spawn_server, port, type SpawnedServer } from '@ogygia/tooling/e2e/servers.ts';
import { PROGRAMS } from './_programs.ts';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const app = path.join(repo, 'apps/plain-islands');
const immutable_of = (dir: string): string =>
	path.join(dir, '.svelte-kit/output/client/_app/immutable');
const PORT = port(3062);
const BASE = `http://localhost:${PORT}`;
const RUNTIME_RE = /^og-runtime[.-][^/]*\.js$/;

let server: SpawnedServer | undefined;
let boot_error = '';

/** The runtime file of the app built in `dir`, and every chunk it imports statically: what every
 *  page of it downloads to boot. */
function boot_code(dir: string): string {
	const immutable = immutable_of(dir);
	const runtime = fs.readdirSync(immutable).find((f) => RUNTIME_RE.test(f));
	if (runtime === undefined) throw new Error(`no og-runtime file in ${immutable}`);
	const seen = new Set<string>();
	const walk = (file: string): void => {
		if (seen.has(file)) return;
		seen.add(file);
		const code = fs.readFileSync(file, 'utf8');
		for (const m of code.matchAll(/(?:import|from)\s*"(\.{1,2}\/[^"]+\.js)"/g))
			walk(path.resolve(path.dirname(file), m[1]));
	};
	walk(path.join(immutable, runtime));
	return [...seen].map((f) => fs.readFileSync(f, 'utf8')).join('\n');
}

/** The region element around the counter named `name`. */
const region_of = (page: Page, name: string) =>
	page.locator(`ogygia-region:has([data-counter="${name}"])`);
const button_of = (page: Page, name: string) => page.locator(`[data-counter="${name}"] button`);

/** Every page error, console error and region-endpoint request the page makes. */
function watch(page: Page): { errors: string[]; region_fetches: string[] } {
	const out = { errors: [] as string[], region_fetches: [] as string[] };
	page.on('pageerror', (e) => out.errors.push(e.message));
	page.on('console', (m) => m.type() === 'error' && out.errors.push(m.text()));
	page.on('request', (r) => r.url().includes('/__ogygia__') && out.region_fetches.push(r.url()));
	return out;
}

test.describe('the plainest app: islands only, a boot without frames', () => {
	test.beforeAll(async () => {
		test.setTimeout(10 * 60_000);
		build_app(app);
		try {
			server = await spawn_server({
				cmd: path.join(app, 'node_modules/.bin/vite'),
				args: ['preview', '--port', String(PORT), '--strictPort'],
				cwd: app,
				env: { ORIGIN: BASE },
				url: `${BASE}/`,
				timeout_ms: 30_000
			});
		} catch (e) {
			boot_error = String((e as Error)?.message || e);
		}
	});
	test.afterAll(() => server?.kill());

	test('its boot holds the region element and no program its marks never run', () => {
		const code = boot_code(app);
		expect(code, 'the boot defines the region element').toContain('ogygia-region');
		for (const p of PROGRAMS)
			for (const text of p.strings ?? [])
				expect(code.includes(text), `the boot holds the ${p.name} ('${text}')`).toBe(false);
	});

	test("the palaestra's boot, which every feature's marks select, holds every program", () => {
		const code = boot_code(path.join(repo, 'apps/palaestra'));
		for (const p of PROGRAMS.filter((row) => row.feature !== null || row.kit))
			for (const text of p.strings ?? [])
				expect(code.includes(text), `the boot lacks the ${p.name} ('${text}')`).toBe(true);
	});

	test('a load, an idle, an interaction and a visible island each wake and count', async ({
		page
	}) => {
		expect(server, boot_error).toBeDefined();
		const seen = watch(page);
		await page.goto(`${BASE}/`);

		await expect(region_of(page, 'load')).toHaveAttribute('data-hydrated', /.*/);
		await button_of(page, 'load').click();
		await expect(button_of(page, 'load')).toHaveText('count is 2');

		await expect(region_of(page, 'idle')).toHaveAttribute('data-hydrated', /.*/);
		await button_of(page, 'idle').click();
		await expect(button_of(page, 'idle')).toHaveText('count is 11');

		// (the click that wakes it is replayed once it hydrates)
		await expect(region_of(page, 'interaction')).not.toHaveAttribute('data-hydrated');
		await button_of(page, 'interaction').click();
		await expect(button_of(page, 'interaction')).toHaveText('count is 21');

		await expect(region_of(page, 'visible')).not.toHaveAttribute('data-hydrated');
		await button_of(page, 'visible').scrollIntoViewIfNeeded();
		await expect(region_of(page, 'visible')).toHaveAttribute('data-hydrated', /.*/);
		await button_of(page, 'visible').click();
		await expect(button_of(page, 'visible')).toHaveText('count is 31');

		expect(seen.errors).toEqual([]);
		expect(seen.region_fetches).toEqual([]);
	});

	test('a link to another page loads it whole, and its island wakes', async ({ page }) => {
		expect(server, boot_error).toBeDefined();
		const seen = watch(page);
		await page.goto(`${BASE}/`);
		await expect(region_of(page, 'load')).toHaveAttribute('data-hydrated', /.*/);
		await page.locator('[data-about-link]').click();
		await page.waitForURL(`${BASE}/about`);
		await expect(region_of(page, 'about')).toHaveAttribute('data-hydrated', /.*/);
		await button_of(page, 'about').click();
		await expect(button_of(page, 'about')).toHaveText('count is 41');
		expect(seen.errors).toEqual([]);
		expect(seen.region_fetches).toEqual([]);
	});
});
