// A runtime where sharp cannot load (an edge or Workers runtime, an install without its binary): the
// endpoint answers a coded 500 that no cache keeps, said once, instead of a bare crash.
import { expect, test, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';

vi.mock('virtual:ogygia-image/sources', () => ({
	default: { '/src/lib/a.jpg': '/_app/immutable/assets/a.Ab12.jpg' }
}));
vi.mock('virtual:ogygia-image/config', () => ({
	default: { paths: { base: '', assets: '', app_dir: '_app' } }
}));
vi.mock('$app/environment', () => ({ building: false }));
vi.mock('../src/settle.ts', () => {
	throw new Error('Could not load the "sharp" module');
});

const { default: server } = await import('../src/server.ts');
const { mint } = await import('../src/recipe.ts');
const { ctx } = startPlugin(server, { name: '@ogygia/image' });

test('an endpoint that cannot load the encoder answers a coded 500, said once', async () => {
	const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
	const url = mint({
		id: 'a1',
		src: '/_app/immutable/assets/a.Ab12.jpg',
		width: 48,
		height: 48,
		format: 'webp'
	})!;
	for (let i = 0; i < 2; i++) {
		const res = (await server.request!(ctx(new Request(`http://localhost${url}`))))!;
		expect(res.status).toBe(500);
		expect(res.headers.get('cache-control')).toBe('no-store');
	}
	expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
		expect.stringMatching(/image_no_encoder/)
	]);
	warn.mockRestore();
});
