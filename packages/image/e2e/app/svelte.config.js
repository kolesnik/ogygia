import adapter from '@sveltejs/adapter-node';
import static_adapter from '@sveltejs/adapter-static';
import cloudflare_adapter from '@sveltejs/adapter-cloudflare';
import vercel_adapter from '@sveltejs/adapter-vercel';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { preprocess, extensions } from '@ogygia/content/vite';

// IMAGE_E2E_STATIC=1: every page prerendered, written as plain files to build/static (served with no
// server), with an SPA fallback page (404.html) the adapter renders after the build; otherwise adapter-node, every page rendered on request. IMAGE_E2E_BASE: the app's
// paths.base (`/base`). IMAGE_E2E_ADAPTER=cloudflare|vercel: that adapter, every page prerendered
// but /late, which renders on request.
const STATIC = process.env.IMAGE_E2E_STATIC === '1';
const BASE = process.env.IMAGE_E2E_BASE ?? '';
const PAGES = process.env.IMAGE_E2E_PAGES ?? 'build/static';
const ADAPTER = process.env.IMAGE_E2E_ADAPTER;

function adapted() {
	if (ADAPTER === 'cloudflare') return cloudflare_adapter();
	if (ADAPTER === 'vercel') return vercel_adapter({ runtime: 'nodejs22.x' });
	if (STATIC) return static_adapter({ pages: PAGES, fallback: '404.html', strict: true });
	return adapter();
}

/** @type {import('@sveltejs/kit').Config} */
const config = {
	extensions: extensions(),
	preprocess: [vitePreprocess(), ...preprocess()],
	compilerOptions: {
		experimental: { async: true }
	},
	kit: {
		adapter: adapted(),
		paths: { base: BASE },
		prerender: { origin: 'https://example.com' }
	}
};

export default config;
