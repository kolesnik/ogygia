import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect, test, vi } from 'vitest';
import { handoff_for, save_warm, settle_minted } from '../src/vite/build-files.ts';
import { note_minted_url } from '../src/store.ts';

vi.hoisted(() => {
	delete process.env.__OGYGIA_IMAGE_BUILD;
});

const PATHS = { base: '', assets: '', app_dir: '_app' };

test('a watch rebuild after the build ended notes its prerender and its warm list again', async () => {
	const handoff = handoff_for(true);
	const output = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-out-'));
	await settle_minted(handoff, PATHS, output);
	expect(() => save_warm(handoff, [])).not.toThrow();
	expect(() => note_minted_url(handoff.minted, '/__ogygia__/i/x/a-1x1/a.jpg.webp')).not.toThrow();
	expect(fs.readFileSync(handoff.minted, 'utf8')).toBe('/__ogygia__/i/x/a-1x1/a.jpg.webp\n');
});

test('a run a failed build left behind is removed by a later build, once a day old', () => {
	const first = handoff_for(true);
	const left = path.dirname(first.minted);
	const fresh = path.join(path.dirname(left), 'fresh-run');
	fs.mkdirSync(fresh, { recursive: true });
	const long_ago = new Date(Date.now() - 2 * 24 * 3600 * 1000);
	fs.utimesSync(left, long_ago, long_ago);
	delete process.env.__OGYGIA_IMAGE_BUILD;
	const next = handoff_for(true);
	expect(path.dirname(next.minted)).not.toBe(left);
	expect(fs.existsSync(left)).toBe(false);
	expect(fs.existsSync(fresh)).toBe(true);
	fs.rmSync(fresh, { recursive: true });
});
