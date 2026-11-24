// @ogygia/image's e2e suite against its fixture app (e2e/app), in one of three modes, the same pages
// and specs each time (`IMAGE_E2E_MODE`):
// - `node` (default): built with adapter-node and served (`vite preview`): files made on request;
// - `static`: every page prerendered with adapter-static and served as plain files, no server;
// - `dev`: the dev server.
// `pnpm --filter @ogygia/image e2e` runs all three.
import type { PlaywrightTestConfig } from '@playwright/test';
import { suite } from '@ogygia/tooling/e2e/config.ts';
import { port } from '@ogygia/tooling/e2e/servers.ts';
import { fileURLToPath } from 'node:url';

const app = fileURLToPath(new URL('./e2e/app', import.meta.url));
const build = fileURLToPath(import.meta.resolve('@ogygia/tooling/e2e/build.ts'));
const serve_static = fileURLToPath(new URL('./e2e/serve-static.ts', import.meta.url));

function config(mode: string): PlaywrightTestConfig {
	if (mode === 'static')
		return suite({
			port: 3064,
			serve: app,
			env: { IMAGE_E2E_STATIC: '1' },
			command: `node ${build} && node ${serve_static} build/static ${port(3064)}`
		});
	if (mode === 'dev')
		return suite({
			port: 3063,
			serve: app,
			command: `node node_modules/vite/bin/vite.js dev --port ${port(3063)} --strictPort`
		});
	return suite({ port: 3062, serve: app });
}

export default config(process.env.IMAGE_E2E_MODE ?? 'node');
