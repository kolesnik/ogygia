import { expect, test } from 'vitest';
import { is_warmed_module, warm_island_module } from '../../src/runtime/island-warm.ts';

test('a module link whose href no URL parser takes was never warmed, and asking does not throw', () => {
	warm_island_module('/test/browser/fixtures/slow-entry.ts?warm-key');
	expect(is_warmed_module('/test/browser/fixtures/slow-entry.ts?warm-key')).toBe(true);
	expect(is_warmed_module('https://example.com:99999/x.js')).toBe(false);
	expect(is_warmed_module('https://example.com:99999/x.js', 'https://example.com/page')).toBe(false);
});
