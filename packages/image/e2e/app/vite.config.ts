import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { content } from '@ogygia/content/vite';
import { image } from '@ogygia/image/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [ogygia(), content({ markdown: {} }), image({ markdown: { width: 720 } }), sveltekit()]
});
