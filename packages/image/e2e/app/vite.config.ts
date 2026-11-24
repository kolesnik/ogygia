import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { content } from '@ogygia/content/vite';
import { image } from '@ogygia/image/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	define: { __IMAGE_E2E_STATIC__: JSON.stringify(process.env.IMAGE_E2E_STATIC === '1') },
	plugins: [
		ogygia(),
		content({ markdown: {} }),
		image({
			presets: {
				cover: { layout: 'fullWidth', aspect: '16/9', priority: true },
				thumb: { width: 200, aspect: '1/1' },
				avatar: { layout: 'fixed', width: 48, height: 48 },
				prose: { width: 720 }
			}
		}),
		sveltekit()
	]
});
