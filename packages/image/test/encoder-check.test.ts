// sharp is a peer the app installs: a build or dev server that cannot reach it from the app, or whose
// server output would bundle it, fails with a coded error before any image is made.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import type { Plugin, ResolvedConfig } from 'vite';
import { expect, test, vi } from 'vitest';
import { check, dead_fields } from '@ogygia/machine/testing';
import { ENCODER } from '../src/vite/encoder.ts';
import { image } from '../src/vite/index.ts';

vi.hoisted(() => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
});

const SHARP_DIR = path.dirname(path.dirname(createRequire(import.meta.url).resolve('sharp')));
const NODE = '"@sveltejs/adapter-node"';
const STATIC = '"@sveltejs/adapter-static"';
const EDGE = '"@sveltejs/adapter-cloudflare"';

/** An app folder: its package.json lists sharp under `listed` (or nowhere), and `installed` links
 *  sharp into its node_modules. */
function app(listed: 'dependencies' | 'devDependencies' | null, installed: boolean): string {
	const root = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-sharp-'));
	const pkg: Record<string, unknown> = { name: 'app', private: true, type: 'module' };
	if (listed) pkg[listed] = { sharp: '^0.35.0' };
	fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg));
	if (installed) {
		fs.mkdirSync(path.join(root, 'node_modules'));
		fs.symlinkSync(SHARP_DIR, path.join(root, 'node_modules', 'sharp'), 'dir');
	}
	return root;
}

async function resolved(root: string, adapter: string | null, command = 'build'): Promise<void> {
	const plugin = image().find((p) => p.name === '@ogygia/image:load') as Plugin;
	const define: Record<string, string> = { __SVELTEKIT_APP_DIR__: '"_app"' };
	if (adapter) define.__SVELTEKIT_ADAPTER_NAME__ = adapter;
	await (plugin.configResolved as (c: unknown) => unknown)({
		root,
		command,
		build: { ssr: command === 'build', outDir: path.join(root, '.svelte-kit/output/server') },
		define
	} as unknown as ResolvedConfig);
}

test('a node server build fails, coded, when the app does not install sharp itself', async () => {
	await expect(resolved(app(null, false), NODE)).rejects.toThrow(/image_sharp_missing/);
});

test("a node server build fails, coded, when sharp is installed but not in the app's dependencies, so the adapter would bundle it", async () => {
	await expect(resolved(app('devDependencies', true), NODE)).rejects.toThrow(
		/image_sharp_missing.*dependencies|dependencies[\s\S]*image_sharp_missing/
	);
	await expect(resolved(app(null, true), NODE)).rejects.toThrow(/image_sharp_missing/);
});

test("a node server build with sharp in the app's dependencies goes on", async () => {
	await expect(resolved(app('dependencies', true), NODE)).resolves.toBeUndefined();
});

test('a static build, which runs no server, only needs sharp installed', async () => {
	await expect(resolved(app('devDependencies', true), STATIC)).resolves.toBeUndefined();
	await expect(resolved(app(null, false), STATIC)).rejects.toThrow(/image_sharp_missing/);
});

test('the dev server fails, coded, when the app does not install sharp', async () => {
	await expect(resolved(app(null, false), null, 'serve')).rejects.toThrow(/image_sharp_missing/);
	await expect(resolved(app('devDependencies', true), null, 'serve')).resolves.toBeUndefined();
});

test('an edge build warns that its server cannot encode, and needs sharp only to build', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	await expect(resolved(app('devDependencies', true), EDGE)).resolves.toBeUndefined();
	expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
		expect.stringMatching(/image_adapter_no_encoder/)
	]);
	warn.mockRestore();
	await expect(resolved(app(null, false), EDGE)).rejects.toThrow(/image_sharp_missing/);
});

test('every row of the encoder table: nothing goes on without sharp listed and installed, and no server without it in dependencies', () => {
	check(ENCODER, {
		'no sharp installed fails': (r) => !('plan' in r) || r.input.installed || r.plan === 'missing',
		'not listed fails': (r) => !('plan' in r) || r.input.listed !== 'none' || r.plan === 'missing',
		'a server goes on only with sharp in dependencies': (r) =>
			!('plan' in r) ||
			r.input.runtime !== 'server' ||
			r.plan !== 'ok' ||
			r.input.listed === 'dependencies',
		'an edge build that has sharp warns': (r) =>
			!('plan' in r) || r.input.runtime !== 'edge' || r.plan !== 'ok'
	});
	expect(dead_fields(ENCODER)).toEqual([]);
});
