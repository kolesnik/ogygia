import adapter from '@sveltejs/adapter-node';
import static_adapter from '@sveltejs/adapter-static';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import { preprocess, extensions } from '@ogygia/content/vite';

// IMAGE_E2E_STATIC=1: every page prerendered, written as plain files to build/static (served with no
// server); otherwise adapter-node, every page rendered on request. IMAGE_E2E_BASE: the app's
// paths.base (`/base`).
const STATIC = process.env.IMAGE_E2E_STATIC === '1';
const BASE = process.env.IMAGE_E2E_BASE ?? '';
const PAGES = process.env.IMAGE_E2E_PAGES ?? 'build/static';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	extensions: extensions(),
	preprocess: [vitePreprocess(), ...preprocess()],
	compilerOptions: {
		experimental: { async: true }
	},
	kit: {
		adapter: STATIC ? static_adapter({ pages: PAGES, strict: true }) : adapter(),
		paths: { base: BASE }
	}
};

export default config;
