// The prerender's head start (`prepare`) makes a file early only with a maker that runs in the
// build: with the Images binding (cloudflare()), or no maker (vercel() alone), the build's end makes
// every file with sharp, so the head start reads and hashes no original for nothing.
import { expect, test, vi } from 'vitest';

const io = vi.hoisted(() => ({ reads: 0 }));

vi.mock('$app/server', () => ({
	read: () => {
		io.reads++;
		return new Response(new Uint8Array([1, 2, 3]));
	}
}));
vi.mock('virtual:ogygia-image/maker', async () => {
	const { binding_maker } = await import('../src/makers/binding.ts');
	return binding_maker('IMAGES');
});

test('with a maker that cannot run in the build, the head start reads no original', async () => {
	const { prepare } = await import('../src/settle.ts');
	const recipe = {
		id: 'AAAAAAAAAAAAAAAA',
		tail: 'a.png',
		width: 40,
		height: 20,
		format: 'webp' as const
	};
	await prepare(
		recipe as never,
		'AAAAAAAAAAAAAAAA-40x20.webp',
		'/_app/immutable/assets/a.png'
	).catch(() => {});
	expect(io.reads).toBe(0);
});
