// What `<Img>` and `layOut()` name: a warmed preset's static files when the request is exactly that
// preset's, the minter's signed URLs for anything else.
import { expect, test, vi } from 'vitest';

vi.mock('virtual:ogygia-image/config', () => ({
	default: {
		formats: ['avif', 'webp'],
		breakpoints: [320, 640],
		presets: { thumb: { width: 200, aspect: '1/1' }, cover: { layout: 'fullWidth' } },
		paths: { base: '/shop', assets: '', app_dir: '_app' },
		warmed: true
	}
}));

const { layOut } = await import('../src/render.ts');
const { set_minter, recipe_head } = await import('../src/recipe.ts');
set_minter((r) => `/signed/${recipe_head(r)}`);

const OF = {
	id: 'p1',
	src: '/shop/_app/immutable/assets/p.B1.jpg',
	width: 800,
	height: 1000,
	format: 'jpeg' as const,
	warm: ['thumb']
};
const files = (srcset: string | undefined) =>
	(srcset ?? '').split(', ').map((c) => c.split(' ')[0]);

test('a warmed preset names the files the build made, under the app folder at the base', () => {
	const laid = layOut(OF, { preset: 'thumb' });
	for (const url of [...files(laid.srcset), ...files(laid.sources[0]!.srcset), laid.src])
		expect(url).toMatch(/^\/shop\/_app\/immutable\/og\/p1-\d+x\d+\.(avif|webp)$/);
});

test('the same preset said over, another preset, or a source not warmed with it, is signed', () => {
	for (const laid of [
		layOut(OF, { preset: 'thumb', width: 300 }),
		layOut(OF, { preset: 'cover' }),
		layOut({ ...OF, warm: undefined }, { preset: 'thumb' })
	])
		for (const url of files(laid.srcset)) expect(url).toMatch(/^\/signed\//);
	for (const url of files(layOut(OF, { preset: 'thumb', sizes: '50vw' }).srcset))
		expect(url).toMatch(/^\/shop\/_app\/immutable\/og\//);
});
