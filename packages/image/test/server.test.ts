import crypto from 'node:crypto';
import fs from 'node:fs';
import sharp from 'sharp';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { make_images } from './fixtures.ts';

const files = vi.hoisted(() => new Map<string, string>());

vi.mock('virtual:ogygia-image/sources', () => ({
	default: {
		'/src/lib/harbor dusk.jpg': '/_app/immutable/assets/harbor%20dusk.Ab12.jpg',
		'/src/lib/spin.gif': '/_app/immutable/assets/spin.Cd34.gif',
		'/src/lib/broken.jpg': '/_app/immutable/assets/broken.Ef56.jpg'
	}
}));
vi.mock('$app/server', () => ({
	read: (asset: string) => {
		const file = files.get(asset);
		if (!file) throw new Error(`Asset does not exist: ${asset}`);
		return new Response(fs.readFileSync(file));
	}
}));

const { default: server } = await import('../src/server.ts');
const { mint, set_minter } = await import('../src/recipe.ts');

const KEY = 'a test key';
const sign = (m: string): string => crypto.createHmac('sha256', KEY).update(m).digest('hex');
const app = { sign } as never;

type Req = NonNullable<typeof server.request>;
async function get(url: string): Promise<Response | undefined> {
	const ctx = { event: { url: new URL(url, 'http://localhost') }, app } as unknown as Parameters<Req>[0];
	return (await server.request!(ctx)) ?? undefined;
}

const HARBOR = { id: 'h1', src: '/_app/immutable/assets/harbor%20dusk.Ab12.jpg' };

beforeAll(async () => {
	const img = await make_images();
	files.set('/_app/immutable/assets/harbor%20dusk.Ab12.jpg', img.jpg);
	files.set('/_app/immutable/assets/spin.Cd34.gif', img.gif);
	const broken = `${img.dir}/broken.jpg`;
	fs.writeFileSync(broken, 'not a jpeg');
	files.set('/_app/immutable/assets/broken.Ef56.jpg', broken);
	set_minter(null);
	server.setup!(app);
});

describe('the image server realm', () => {
	test('a minted URL is a path under the image prefix, the same on every render', () => {
		const a = mint({ ...HARBOR, width: 320, height: 213, format: 'avif' })!;
		expect(a).toMatch(
			/^\/__ogygia__\/image\/[0-9a-f]{32}\/h1-320x213\/_app\/immutable\/assets\/harbor%20dusk\.Ab12\.jpg\.avif$/
		);
		expect(mint({ ...HARBOR, width: 320, height: 213, format: 'avif' })).toBe(a);
	});

	test('the endpoint makes the file the URL describes, kept forever', async () => {
		const url = mint({ ...HARBOR, width: 320, height: 320, format: 'webp', position: 'top' })!;
		const res = (await get(url))!;
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/webp');
		expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
		const meta = await sharp(Buffer.from(await res.arrayBuffer())).metadata();
		expect([meta.format, meta.width, meta.height]).toEqual(['webp', 320, 320]);
	});

	test('an animated source stays animated', async () => {
		const url = mint({
			id: 's1',
			src: '/_app/immutable/assets/spin.Cd34.gif',
			width: 160,
			height: 120,
			format: 'webp'
		})!;
		const res = (await get(url))!;
		const meta = await sharp(Buffer.from(await res.arrayBuffer()), { animated: true }).metadata();
		expect(meta.pages).toBe(3);
	});

	test('a URL whose recipe was changed after signing is refused', async () => {
		const url = mint({ ...HARBOR, width: 48, height: 48, format: 'webp' })!;
		expect((await get(url.replace('-48x48/', '-4000x4000/')))!.status).toBe(403);
	});

	test('a URL with no signature, or a forged one, is refused', async () => {
		const url = mint({ ...HARBOR, width: 48, height: 48, format: 'webp' })!;
		const sig = /image\/([0-9a-f]{32})\//.exec(url)![1]!;
		expect((await get(url.replace(`${sig}/`, '')))!.status).toBe(403);
		expect((await get(url.replace(sig, '0'.repeat(32))))!.status).toBe(403);
	});

	test('a signed recipe naming an original the app does not ship is not found', async () => {
		const url = mint({
			id: 'x',
			src: '/_app/immutable/assets/secret.Zz.jpg',
			width: 48,
			height: 48,
			format: 'webp'
		})!;
		expect((await get(url))!.status).toBe(404);
	});

	test('a signed path that is not a recipe is not found', async () => {
		const bad = 'h1-48x48/_app/%E0%A4%A.jpg.webp';
		const bad_sig = sign(`image|${bad}`).slice(0, 32);
		expect((await get(`/__ogygia__/image/${bad_sig}/${bad}`))!.status).toBe(404);
	});

	test('an original that cannot be decoded is a coded 500, not a hung request', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const url = mint({
			id: 'b1',
			src: '/_app/immutable/assets/broken.Ef56.jpg',
			width: 48,
			height: 48,
			format: 'webp'
		})!;
		expect((await get(url))!.status).toBe(500);
		expect(String(warn.mock.calls[0]?.[0])).toMatch(/image_settle_failed/);
		warn.mockRestore();
	});

	test('a request for any other path passes through', async () => {
		expect(await get('/blog/first-post')).toBeUndefined();
		expect(await get('/__ogygia__')).toBeUndefined();
	});
});
