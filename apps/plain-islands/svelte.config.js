import adapter from '@sveltejs/adapter-node';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	preprocess: vitePreprocess(),
	compilerOptions: {
		experimental: { async: true }
	},
	kit: {
		adapter: adapter(),
		outDir: process.env.OGYGIA_E2E_OUT_DIR
	}
};

export default config;
