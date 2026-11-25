// The fixture app built with adapter-vercel, with today's encoder, `sharp()`
// (`IMAGE_E2E_MODE=vercel`): every page prerendered but /late, which the function renders on
// request. Its static files and its function are served by e2e/serve-vercel.ts; the headers
// Vercel's router adds are read from `.vercel/output/config.json`'s routes.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test, expect } from '@ogygia/tooling/e2e';

const APP = fileURLToPath(new URL('./app/', import.meta.url));
const OUTPUT = path.join(APP, '.vercel/output');
const FUNC = path.join(OUTPUT, 'functions/![-]/catchall.func');
const PRERENDERED = ['/', '/blog/first-post', '/blog/second-post', '/blog/third-post', '/island'];
const BUILT_RE = /\/_app\/immutable\/og\/[\w-]+\.(?:avif|webp)/g;
const SIGNED_RE = /\/__ogygia__\/i\/[^\s",)]+/g;
const KEPT = 'public, immutable, max-age=31536000';

interface Route {
	src?: string;
	handle?: string;
	headers?: Record<string, string>;
	status?: number;
	continue?: boolean;
	dest?: string;
	transforms?: unknown[];
}

const ROUTE_KEYS: ReadonlySet<string> = new Set([
	'src',
	'handle',
	'headers',
	'status',
	'continue',
	'dest',
	'transforms'
]);

/**
 * The status and headers Vercel's router gives `pathname`, from the output's routes (Build Output
 * API v3), for a path the router never rewrites: the routes before `handle: filesystem` add their
 * headers (one that matches with no `continue` ends that phase), the filesystem answers a file that
 * is there, and the routes after it answer one that is not. Throws on a route key it does not read.
 */
function routed(
	pathname: string,
	exists: boolean
): { status: number; headers: Record<string, string> } {
	const config = JSON.parse(fs.readFileSync(path.join(OUTPUT, 'config.json'), 'utf8')) as {
		routes: Route[];
	};
	const headers: Record<string, string> = {};
	let phase: 'before' | 'after' = 'before';
	let done = false;
	for (const route of config.routes) {
		for (const key of Object.keys(route))
			if (!ROUTE_KEYS.has(key)) throw new Error(`a route key this reader does not read: ${key}`);
		if (route.handle === 'filesystem') {
			if (exists) return { status: 200, headers };
			phase = 'after';
			done = false;
			continue;
		}
		if (route.handle !== undefined)
			throw new Error(`a phase this reader does not read: ${route.handle}`);
		if (done || !new RegExp(`^${route.src}$`).test(pathname)) continue;
		if (route.dest !== undefined) throw new Error(`a rewrite of ${pathname}: ${route.dest}`);
		Object.assign(headers, route.headers);
		if (phase === 'after' && route.status !== undefined) return { status: route.status, headers };
		if (!route.continue) done = true;
	}
	throw new Error(`no route answers ${pathname}`);
}

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

test('every file a prerendered page names is a static file of the output, routed to be kept forever', async ({
	request
}) => {
	const urls = await named(request, PRERENDERED, BUILT_RE);
	expect(urls.length).toBeGreaterThan(40);
	expect(await named(request, PRERENDERED, SIGNED_RE)).toEqual([]);
	for (const url of urls) {
		expect(fs.existsSync(path.join(OUTPUT, 'static', url)), url).toBe(true);
		const res = await request.get(url);
		expect(res.status(), url).toBe(200);
		expect(routed(url, true), url).toEqual({ status: 200, headers: { 'cache-control': KEPT } });
	}
});

test('an original under _app/immutable/assets is routed to be kept forever too', () => {
	const original = fs
		.readdirSync(path.join(OUTPUT, 'static/_app/immutable/assets'))
		.find((f) => f.endsWith('.jpg'))!;
	expect(routed(`/_app/immutable/assets/${original}`, true)).toEqual({
		status: 200,
		headers: { 'cache-control': KEPT }
	});
});

test('a built file that is not there is routed to a 404 kept nowhere', () => {
	expect(routed('/_app/immutable/og/AAAAAAAAAAAAAAAA-48x48.avif', false)).toEqual({
		status: 404,
		headers: { 'cache-control': 'no-store' }
	});
});

test('the function holds sharp, the encoder the config lists, and makes every file a live page names, kept forever', async ({
	request
}) => {
	const vc = JSON.parse(fs.readFileSync(path.join(FUNC, '.vc-config.json'), 'utf8')) as {
		runtime: string;
	};
	expect(vc.runtime).toBe('nodejs22.x');
	expect(fs.existsSync(path.join(FUNC, 'packages/image/e2e/app/node_modules/sharp'))).toBe(true);
	const urls = await named(request, ['/late'], SIGNED_RE);
	expect(urls.length).toBeGreaterThan(0);
	for (const url of urls) {
		const res = await request.get(url);
		expect(res.status(), url).toBe(200);
		expect(res.headers()['content-type'], url).toBe(`image/${/\.(\w+)$/.exec(url)![1]}`);
		expect(res.headers()['cache-control'], url).toBe('public, max-age=31536000, immutable');
	}
});

test('the function refuses a forged signature and a POST, kept nowhere', async ({ request }) => {
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
