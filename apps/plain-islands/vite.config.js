import { sveltekit } from '@sveltejs/kit/vite';
import { ogygia } from 'ogygia/vite';
import { defineConfig } from 'vite';

// THE PLAINEST APP: csr=false pages whose regions are islands only (no deferred hole, no lake, no
// held region, no router), so its build's feature word has no frames bit and the region element's
// hole and live programs fold out of the boot. Its one user is
// apps/palaestra/e2e/plain-islands.spec.ts.
export default defineConfig({
	plugins: [ogygia(), sveltekit()]
});
