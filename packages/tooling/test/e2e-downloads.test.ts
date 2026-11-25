// The e2e downloads record (src/e2e/downloads.ts): a spec that reads downloads without having made
// the record before its goto would read nothing and pass without looking; it throws instead. The
// page code runs here against a stand-in page whose `evaluate` calls it on a stand-in window.
import { afterEach, describe, expect, it } from 'vitest';
import type { Page } from '@playwright/test';
import { downloads } from '../src/e2e/downloads.ts';

const g = globalThis as { window?: unknown };
const page = { evaluate: async (fn: () => unknown) => fn() } as unknown as Page;

afterEach(() => {
	delete g.window;
});

describe('downloads', () => {
	it('a page with no record made before its goto throws, naming the call it lacks', async () => {
		g.window = {};
		await expect(downloads(page)).rejects.toThrow(
			'hear_downloads(page) was not called before goto'
		);
	});

	it('a page with the record reads each download heard, as plain fields', async () => {
		const heard = [
			{ name: 'https://x.test/a.js', startTime: 1, responseEnd: 2, initiatorType: 'script' }
		];
		g.window = { __og_downloads: () => heard };
		await expect(downloads(page)).resolves.toEqual([
			{ name: 'https://x.test/a.js', start: 1, end: 2, initiator: 'script' }
		]);
	});
});
