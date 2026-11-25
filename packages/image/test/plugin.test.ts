// The plugin's load hook: which originals the server may read, and the paths it hands `<Img>`.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { beforeAll, expect, test } from 'vitest';
import { image } from '../src/vite/index.ts';
import { app_with_sharp, make_images } from './fixtures.ts';

let root: string;
beforeAll(async () => {
	const img = await make_images();
	root = app_with_sharp(fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-plugin-')));
	for (const rel of ['src/lib/server/secret.jpg', 'src/lib/a.jpg', 'src/lib/__tests__/t.jpg']) {
		fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
		fs.copyFileSync(img.jpg, path.join(root, rel));
	}
});

async function loader(
	define: Record<string, string> = { __SVELTEKIT_APP_DIR__: '"_app"' }
): Promise<Plugin> {
	const plugin = image().find((p) => p.name === '@ogygia/image:load')!;
	await (plugin.configResolved as (c: unknown) => unknown)({
		root,
		command: 'serve',
		build: {},
		define
	} as unknown as ResolvedConfig);
	return plugin;
}

function load(plugin: Plugin, id: string): Promise<unknown> {
	const ctx = { addWatchFile: () => {} };
	return Promise.resolve((plugin.load as (this: unknown, id: string) => unknown).call(ctx, id));
}

test('the server reads no original under src/lib/server or in a test folder, and the macro says so', async () => {
	const plugin = await loader();
	const sources = String(await load(plugin, '\0virtual:ogygia-image/sources'));
	expect(sources).toContain('"!/src/lib/server/**"');
	expect(sources).toContain('"!/src/**/__tests__/**"');
	for (const rel of ['src/lib/server/secret.jpg', 'src/lib/__tests__/t.jpg'])
		await expect(load(plugin, `${path.join(root, rel)}?og-image`)).rejects.toThrow(
			/outside src\/lib\/server\/ and test files/
		);
	expect(String(await load(plugin, `${path.join(root, 'src/lib/a.jpg')}?og-image`))).toMatch(
		/^import __src from/
	);
});

test("<Img> is handed Kit's base, assets and app folder, read from Kit's own plugin", async () => {
	const config = String(
		await load(
			await loader({
				__SVELTEKIT_APP_DIR__: '"_shop"',
				__SVELTEKIT_PATHS_BASE__: '"/shop"',
				__SVELTEKIT_PATHS_ASSETS__: '""'
			}),
			'\0virtual:ogygia-image/config'
		)
	);
	expect(config).toContain('"paths":{"base":"/shop","assets":"","app_dir":"_shop"}');
});

test('without SvelteKit there are no paths to name files by: a coded error, not a silent default', async () => {
	await expect(load(await loader({}), '\0virtual:ogygia-image/config')).rejects.toThrow(
		/found no SvelteKit config/
	);
});
