import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import sharp from 'sharp';
import type { Plugin as VitePlugin } from 'vite';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import type { ImageVariant } from '../src/descriptor.ts';
import { image } from '../src/vite/index.ts';
import { variant_path } from '../src/vite/encode.ts';
import { make_images } from './fixtures.ts';

type Handler = (
	req: http.IncomingMessage,
	res: http.ServerResponse,
	next: (e?: unknown) => void
) => void;

let img: Awaited<ReturnType<typeof make_images>>;
let loader: VitePlugin;
let server: http.Server;
let origin: string;

beforeAll(async () => {
	img = await make_images();
	loader = image()[1]!;
	(loader.configResolved as (c: unknown) => void)({ command: 'serve', base: '/sub/' });
	let handler: Handler | undefined;
	(loader.configureServer as (s: unknown) => void)({
		middlewares: { use: (h: Handler) => (handler = h) }
	});
	server = http.createServer((req, res) => {
		const next = (e?: unknown): void => {
			res.statusCode = e ? 500 : 404;
			res.end(e ? 'error' : 'next');
		};
		try {
			handler!(req, res, next);
		} catch (e) {
			next(e);
		}
	});
	await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server.close());

/** The descriptor the dev `load` returns for `file`. */
async function load(file: string): Promise<{ variants: ImageVariant[] }> {
	const code = (await (loader.load as (this: unknown, id: string) => Promise<string>).call(
		{ addWatchFile() {} },
		`${file}?og-image`
	)) as string;
	return JSON.parse(code.replace(/^export default /, '').replace(/;\s*$/, '')) as {
		variants: ImageVariant[];
	};
}

describe('the dev image route', () => {
	test('a variant URL sits under the app base and serves the encoded file', async () => {
		const { variants } = await load(img.small);
		expect(variants[0]!.src).toMatch(/^\/sub\/@og-image\/[\w-]+\/icon-\d+\.avif$/);
		const res = await fetch(origin + variants[0]!.src);
		expect(res.status).toBe(200);
		expect(res.headers.get('content-type')).toBe('image/avif');
		expect((await sharp(Buffer.from(await res.arrayBuffer())).metadata()).width).toBe(
			variants[0]!.width
		);
	});

	test('an unknown key is a 404', async () => {
		expect((await fetch(`${origin}/sub/@og-image/nope/x-320.avif`)).status).toBe(404);
	});

	test('a malformed escape in the URL is a 404, not a server error', async () => {
		expect((await fetch(`${origin}/sub/@og-image/%E0%A4%A/x.avif`)).status).toBe(404);
	});

	test('after the image file changes, its old URLs are gone and the new ones serve', async () => {
		const file = path.join(img.dir, 'edited.png');
		await sharp({ create: { width: 400, height: 300, channels: 3, background: '#123456' } })
			.png()
			.toFile(file);
		const before = (await load(file)).variants[0]!.src;
		await sharp({ create: { width: 400, height: 300, channels: 3, background: '#654321' } })
			.png()
			.toFile(file);
		const after = (await load(file)).variants[0]!.src;
		expect(after).not.toBe(before);
		expect((await fetch(origin + before)).status).toBe(404);
		expect((await fetch(origin + after)).status).toBe(200);
	});

	test('a variant file that cannot be read is a server error, not a hung request', async () => {
		const { variants } = await load(img.jpg);
		const key = variants.at(-1)!.src.slice('/sub/@og-image/'.length);
		const [id, name] = key.split('/') as [string, string];
		fs.mkdirSync(variant_path(id, name), { recursive: true });
		const res = await fetch(origin + variants.at(-1)!.src, { signal: AbortSignal.timeout(5000) });
		expect(res.status).toBe(500);
	});
});
