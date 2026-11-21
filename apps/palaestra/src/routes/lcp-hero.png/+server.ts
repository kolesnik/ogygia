// The /lcp pages' hero (`fetchpriority="high"`, the page's LCP): a 480x180 PNG of seeded noise,
// about 260 KB that no compression shrinks, so on a slow link it downloads for a second or more and
// anything that shares the link with it shows in its arrival. Made once per server, the same bytes
// every request.
import { crc32, deflateSync } from 'node:zlib';

const W = 480;
const H = 180;

function chunk(type: string, data: Uint8Array): Uint8Array {
	const out = new Uint8Array(12 + data.length);
	const view = new DataView(out.buffer);
	view.setUint32(0, data.length);
	for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
	out.set(data, 8);
	view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
	return out;
}

function noise_png(): Uint8Array {
	const raw = new Uint8Array(H * (1 + W * 3));
	let s = 0x2545f491;
	for (let y = 0; y < H; y++) {
		const row = y * (1 + W * 3);
		raw[row] = 0;
		for (let x = 1; x <= W * 3; x++) {
			s ^= s << 13;
			s ^= s >>> 17;
			s ^= s << 5;
			raw[row + x] = s & 0xff;
		}
	}
	const ihdr = new Uint8Array(13);
	const v = new DataView(ihdr.buffer);
	v.setUint32(0, W);
	v.setUint32(4, H);
	ihdr.set([8, 2, 0, 0, 0], 8);
	const parts = [
		Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', new Uint8Array(0))
	];
	const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
	let at = 0;
	for (const p of parts) {
		out.set(p, at);
		at += p.length;
	}
	return out;
}

const PNG = noise_png();

export const GET = () =>
	new Response(PNG, {
		headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' }
	});
