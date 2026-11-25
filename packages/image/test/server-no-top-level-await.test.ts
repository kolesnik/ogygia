// The image server realm module loads without waiting on its disk half, so a bundle for a target
// with no top-level await (an edge function) can hold it; the disk half loads on the realm's first
// request, which every render follows.
import { expect, test, vi } from 'vitest';

vi.mock('virtual:ogygia-image/sources', () => ({ default: {} }));
vi.mock('virtual:ogygia-image/config', () => ({
	default: { paths: { base: '', assets: '', app_dir: '_app' } }
}));
vi.mock('$app/environment', () => ({ building: false, dev: true }));
vi.mock('../src/on-disk.ts', () => new Promise(() => {}));

test('in dev, the realm module loads before its disk half does', async () => {
	const loaded = await Promise.race([
		import('../src/server.ts').then(() => 'loaded'),
		new Promise((resolve) => setTimeout(resolve, 1000, 'waiting'))
	]);
	expect(loaded).toBe('loaded');
});
