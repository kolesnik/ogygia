// The image server realm, started the way the handle starts it (core's plugin test kit: the app's
// real signer, its own key): the minter's URLs, and the endpoint that answers them.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import sharp from 'sharp';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { startPlugin } from '@ogygia/core/plugin/testing';
import { make_images } from './fixtures.ts';

const files = vi.hoisted(() => new Map<string, string>());
const store = vi.hoisted(() => {
	const dir = `${process.env.TMPDIR ?? '/tmp'}/og-image-server-test-${process.pid}-${Date.now()}`;
	process.env.__OGYGIA_IMAGE_BUILD = JSON.stringify({ store: dir, minted: `${dir}.minted` });
	return dir;
});

vi.mock('virtual:ogygia-image/sources', () => ({
	default: {
		'/src/lib/harbor dusk.jpg': '/_app/immutable/assets/harbor%20dusk.Ab12.jpg',
		'/src/lib/spin.gif': '/_app/immutable/assets/spin.Cd34.gif',
		'/src/lib/broken.jpg': '/_app/immutable/assets/broken.Ef56.jpg'
	}
}));
vi.mock('virtual:ogygia-image/config', () => ({
	default: { paths: { base: '', assets: '', app_dir: '_app' } }
}));
vi.mock('$app/environment', () => ({ building: false }));
vi.mock('$app/server', () => ({
	read: (asset: string) => {
		const file = files.get(asset);
		if (!file) throw new Error(`Asset does not exist: ${asset}`);
		return new Response(fs.readFileSync(file));
	}
}));

const { default: server } = await import('../src/server.ts');
const { mint, set_minter } = await import('../src/recipe.ts');

set_minter(null);
const { app, ctx } = startPlugin(server, { name: '@ogygia/image' });

async function get(url: string): Promise<Response | undefined> {
	return (await server.request!(ctx(new Request(new URL(url, 'http://localhost'))))) ?? undefined;
}

const HARBOR = { id: 'h1', src: '/_app/immutable/assets/harbor%20dusk.Ab12.jpg' };
const SIG_RE = /\/__ogygia__\/i\/([^/]+)\//;

beforeAll(async () => {
	const img = await make_images();
	files.set('/_app/immutable/assets/harbor%20dusk.Ab12.jpg', img.jpg);
	files.set('/_app/immutable/assets/spin.Cd34.gif', img.gif);
	const broken = `${img.dir}/broken.jpg`;
	fs.writeFileSync(broken, 'not a jpeg');
	files.set('/_app/immutable/assets/broken.Ef56.jpg', broken);
});

describe('the image server realm', () => {
	test('a minted URL is a path under /__ogygia__/i/, signed by the app, the same on every render', () => {
		const a = mint({ ...HARBOR, width: 320, height: 213, format: 'avif' })!;
		expect(a).toMatch(
			/^\/__ogygia__\/i\/[\w-]+\/h1-320x213\/_app\/immutable\/assets\/harbor%20dusk\.Ab12\.jpg\.avif$/
		);
		const sig = SIG_RE.exec(a)![1]!;
		expect(app.verify(`image|${a.slice(a.indexOf(sig) + sig.length + 1)}`, sig)).toBe(true);
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

	test('the second ask is read from the store, whole, with its length', async () => {
		const url = mint({ ...HARBOR, width: 200, height: 133, format: 'avif' })!;
		const first = Buffer.from(await (await get(url))!.arrayBuffer());
		expect(fs.readdirSync(store).length).toBeGreaterThan(0);
		const again = (await get(url))!;
		expect(again.headers.get('content-length')).toBe(String(first.byteLength));
		expect(Buffer.from(await again.arrayBuffer()).equals(first)).toBe(true);
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

	test('a URL whose recipe was changed after signing is refused, naming why and the key', async () => {
		const url = mint({ ...HARBOR, width: 48, height: 48, format: 'webp' })!;
		const res = (await get(url.replace('-48x48/', '-4000x4000/')))!;
		expect(res.status).toBe(403);
		expect(res.headers.get('x-ogygia-deny')).toBe('sig');
		expect(res.headers.get('x-ogygia-key')).toBe(app.keyFingerprint());
		expect(res.headers.get('cache-control')).toBe('no-store');
	});

	test('a URL with no signature, or a forged one, is refused', async () => {
		const url = mint({ ...HARBOR, width: 48, height: 48, format: 'webp' })!;
		const sig = SIG_RE.exec(url)![1]!;
		expect((await get(url.replace(`${sig}/`, '')))!.status).toBe(403);
		expect((await get(url.replace(sig, 'A'.repeat(sig.length))))!.status).toBe(403);
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
		expect((await get(`/__ogygia__/i/${app.sign(`image|${bad}`)}/${bad}`))!.status).toBe(404);
	});

	test('an original that cannot be decoded is a coded 500 no cache keeps, not a hung request', async () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const url = mint({
			id: 'b1',
			src: '/_app/immutable/assets/broken.Ef56.jpg',
			width: 48,
			height: 48,
			format: 'webp'
		})!;
		const res = (await get(url))!;
		expect(res.status).toBe(500);
		expect(res.headers.get('cache-control')).toBe('no-store');
		expect(String(warn.mock.calls[0]?.[0])).toMatch(/image_settle_failed/);
		warn.mockRestore();
	});

	test('a request for any other path passes through', async () => {
		expect(await get('/blog/first-post')).toBeUndefined();
		expect(await get('/__ogygia__')).toBeUndefined();
	});
});

describe('the store a live server keeps', () => {
	test("is a folder only its user can open; another version's folder goes once unused for a week, and one in use by a server beside it stays", async () => {
		const { runtime_store } = await import('../src/store.ts');
		const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-store-'));
		const root = path.join(tmp, `ogygia-image-${process.getuid!()}`);
		fs.mkdirSync(path.join(root, 'v0-old'), { recursive: true, mode: 0o700 });
		const long_ago = new Date(Date.now() - 8 * 24 * 3600 * 1000);
		fs.utimesSync(path.join(root, 'v0-old'), long_ago, long_ago);
		const beside = runtime_store('7.0.0', tmp)!;
		const s = runtime_store('8.0.0', tmp)!;
		expect(s.dir.startsWith(root)).toBe(true);
		expect(fs.statSync(root).mode & 0o777).toBe(0o700);
		expect(fs.statSync(s.dir).mode & 0o777).toBe(0o700);
		await expect.poll(() => fs.existsSync(path.join(root, 'v0-old'))).toBe(false);
		expect(fs.existsSync(beside.dir)).toBe(true);
	});

	test('keeps at most its size: the least recently asked files go first, while the server runs', async () => {
		const { FileStore } = await import('../src/store.ts');
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-cap-'));
		const s = new FileStore(dir, 1000);
		await s.keep('a', new Uint8Array(400));
		await s.keep('b', new Uint8Array(400));
		expect(await s.find('a')).not.toBeNull();
		await s.keep('c', new Uint8Array(400));
		await expect.poll(async () => (await s.find('b')) === null).toBe(true);
		expect(await s.find('a')).not.toBeNull();
		expect(await s.find('c')).not.toBeNull();
	});

	test('counts the files a past run left against its size', async () => {
		const { FileStore } = await import('../src/store.ts');
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-cap-'));
		const past = new FileStore(dir, 10_000);
		await past.keep('old', new Uint8Array(600));
		const s = new FileStore(dir, 1000);
		await s.load();
		await s.keep('new', new Uint8Array(600));
		await expect.poll(async () => (await s.find('old')) === null).toBe(true);
		expect(await s.find('new')).not.toBeNull();
	});

	test('a folder at that place that others can write to, or a link, keeps nothing, and says so', async () => {
		const { runtime_store } = await import('../src/store.ts');
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
		const open = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-store-'));
		fs.mkdirSync(path.join(open, `ogygia-image-${process.getuid!()}`), { mode: 0o777 });
		fs.chmodSync(path.join(open, `ogygia-image-${process.getuid!()}`), 0o777);
		expect(runtime_store('8.0.0', open)).toBeNull();
		const linked = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-store-'));
		const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-elsewhere-'));
		fs.symlinkSync(elsewhere, path.join(linked, `ogygia-image-${process.getuid!()}`));
		expect(runtime_store('8.0.0', linked)).toBeNull();
		expect(warn.mock.calls.map((c) => String(c[0]))).toEqual([
			expect.stringMatching(/image_store_unsafe/),
			expect.stringMatching(/image_store_unsafe/)
		]);
		warn.mockRestore();
	});
});
