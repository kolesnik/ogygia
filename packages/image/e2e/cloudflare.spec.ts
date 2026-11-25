// The fixture app built with adapter-cloudflare and run by `wrangler dev` (workerd, local), with
// today's encoder, `sharp()` (`IMAGE_E2E_MODE=cloudflare`): every page prerendered but /late, which
// the Worker renders on request.
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@ogygia/tooling/e2e';
import { server_log } from '@ogygia/tooling/e2e/server-log.ts';

const APP = fileURLToPath(new URL('./app/', import.meta.url));
const PRERENDERED = ['/', '/blog/first-post', '/blog/second-post', '/blog/third-post', '/island'];
const BUILT_RE = /\/_app\/immutable\/og\/[\w-]+\.(?:avif|webp)/g;
const SIGNED_RE = /\/__ogygia__\/i\/[^\s",)]+/g;
const KEPT = 'public, immutable, max-age=31536000';

async function named(
	request: import('@playwright/test').APIRequestContext,
	pages: readonly string[],
	re: RegExp
): Promise<string[]> {
	const seen = new Set<string>();
	for (const p of pages) {
		const res = await request.get(p);
		expect(res.status(), p).toBe(200);
		for (const url of (await res.text()).match(re) ?? []) seen.add(url);
	}
	return [...seen];
}

test("every file a prerendered page names is the build's, served by the asset layer to be kept forever", async ({
	request
}) => {
	const urls = await named(request, PRERENDERED, BUILT_RE);
	expect(urls.length).toBeGreaterThan(40);
	expect(await named(request, PRERENDERED, SIGNED_RE)).toEqual([]);
	for (const url of urls) {
		const res = await request.get(url);
		expect(res.status(), url).toBe(200);
		expect(res.headers()['content-type'], url).toBe(`image/${/\.(\w+)$/.exec(url)![1]}`);
		expect(res.headers()['cache-control'], url).toBe(KEPT);
	}
});

test("an original under _app/immutable/assets is kept forever too, by Kit's _headers rule", async ({
	request
}) => {
	const headers = fs.readFileSync(`${APP}.svelte-kit/cloudflare/_headers`, 'utf8');
	const rule = headers.slice(headers.indexOf('/_app/immutable/*')).split('\n').slice(0, 3);
	expect(rule.map((line) => line.trim())).toEqual([
		'/_app/immutable/*',
		'! Cache-Control',
		`Cache-Control: ${KEPT}`
	]);
	const original = fs
		.readdirSync(`${APP}.svelte-kit/cloudflare/_app/immutable/assets`)
		.find((f) => f.endsWith('.jpg'))!;
	const res = await request.get(`/_app/immutable/assets/${original}`);
	expect(res.status()).toBe(200);
	expect(res.headers()['cache-control']).toBe(KEPT);
});

test("a built file that is not there is the asset layer's 404, and Kit's _headers rule marks it immutable", async ({
	request
}) => {
	const res = await request.get('/_app/immutable/og/AAAAAAAAAAAAAAAA-48x48.avif');
	expect(res.status()).toBe(404);
	expect(res.headers()['cache-control']).toBe(KEPT);
});

test('a live page names signed URLs, and the Worker, with no encoder, answers each 500 kept nowhere and says image_no_encoder', async ({
	request
}) => {
	const urls = await named(request, ['/late'], SIGNED_RE);
	expect(urls.length).toBeGreaterThan(0);
	for (const url of urls) {
		const res = await request.get(url);
		expect(res.status(), url).toBe(500);
		expect(res.headers()['cache-control'], url).toBe('no-store');
	}
	const said = fs.readFileSync(server_log()!, 'utf8');
	expect(said).toMatch(/https:\/\/ogygiajs\.dev\/e\/image_adapter_no_encoder/);
	expect(said).toMatch(/this server cannot make image files: the encoder \(sharp\) did not load/);
	expect(said).toMatch(/https:\/\/ogygiajs\.dev\/e\/image_no_encoder\?reason=/);
});

test('the endpoint refuses a forged signature and a POST, kept nowhere', async ({ request }) => {
	const url = (await named(request, ['/late'], SIGNED_RE))[0]!;
	const sig = /\/i\/([^/]+)\//.exec(url)![1]!;
	const forged = url.replace(
		sig,
		sig.replace(/^./, (c) => (c === '0' ? '1' : '0'))
	);
	const denied = await request.get(forged);
	expect(denied.status()).toBe(403);
	expect(denied.headers()['cache-control']).toBe('no-store');
	const posted = await request.post(url);
	expect(posted.status()).toBe(405);
	expect(posted.headers()['cache-control']).toBe('no-store');
});
