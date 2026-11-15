// FOUND BY THE ALWAYS-ON SIMULATOR (seed 208640100, 40 actions, faults: delay,reorder,tamper,redirect,stall).
// Signature 1b740ba495: waste. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 1b740ba495', () => {
	it('seed 208640100 no longer finds waste 1b740ba495', async () => {
		const r = await run(208640100, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '1b740ba495')).toEqual([]);
	}, 120_000);
});
