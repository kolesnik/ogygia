// The image server realm inside Kit's prerender: every file a page names is a file the build makes,
// under the app folder, named by its recipe alone (no signature, so no key): the same URL in every
// build. The URL carries the build's mark, so Kit's crawler does not ask for a file that is not
// there yet, and each recipe is noted for the build's end to make.
import fs from 'node:fs';
import { describe, expect, test, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';

const run = vi.hoisted(() => {
	const dir = `${process.env.TMPDIR ?? '/tmp'}/og-image-prerender-test-${process.pid}-${Date.now()}`;
	const handoff = {
		store: `${dir}/store`,
		minted: `${dir}/run/minted.txt`,
		mark: '//a1b2c3d4e5f6.ogygia.invalid',
		root: dir
	};
	process.env.__OGYGIA_IMAGE_BUILD = JSON.stringify(handoff);
	return handoff;
});

vi.mock('virtual:ogygia-image/sources', () => ({
	default: { '/src/lib/harbor dusk.jpg': '/shop/_app/immutable/assets/harbor%20dusk.Ab12.jpg' }
}));
vi.mock('virtual:ogygia-image/config', () => ({
	default: { paths: { base: '/shop', assets: '', app_dir: '_app' } }
}));
vi.mock('$app/environment', () => ({ building: true, dev: false }));
vi.mock('$app/server', () => ({
	read: () => {
		throw new Error('not read in this test');
	}
}));

const { default: server } = await import('../src/server.ts');
const { mint } = await import('../src/recipe.ts');
const { app } = startPlugin(server, { name: '@ogygia/image' });

const HARBOR = { id: 'h1', src: '/shop/_app/immutable/assets/harbor%20dusk.Ab12.jpg' };

describe('a prerendered page', () => {
	test('names each file under the app folder at the base, by its recipe, behind the build mark, signing nothing', () => {
		const sign = vi.spyOn(app, 'sign');
		const recipe = { ...HARBOR, width: 320, height: 213, format: 'avif' as const };
		expect(mint(recipe, false)).toBe(
			'//a1b2c3d4e5f6.ogygia.invalid/shop/_app/immutable/og/h1-320x213.avif'
		);
		expect(mint({ ...recipe, quality: 70, position: 'top' }, true)).toBe(
			'//a1b2c3d4e5f6.ogygia.invalid/shop/_app/immutable/og/h1-320x213-q70-ptop.avif'
		);
		expect(sign).not.toHaveBeenCalled();
		sign.mockRestore();
	});

	test('notes each recipe once, with the original it is made from, for the build to make', () => {
		const recipe = { ...HARBOR, width: 640, height: 427, format: 'webp' as const };
		mint(recipe, false);
		mint(recipe, false);
		const lines = fs.readFileSync(run.minted, 'utf8').split('\n');
		expect(lines.filter((l) => l === 'h1-640x427/_app/immutable/assets/harbor%20dusk.Ab12.jpg.webp')).toHaveLength(1);
	});
});
