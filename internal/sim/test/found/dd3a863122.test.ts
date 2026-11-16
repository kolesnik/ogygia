// FOUND BY THE ALWAYS-ON SIMULATOR (seed 691534640, 40 actions, faults: reorder,tamper,redirect).
// Signature dd3a863122: page-errors. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: dd3a863122', () => {
	it('seed 691534640 no longer finds page-errors dd3a863122', async () => {
		const r = await run(691534640, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'dd3a863122')).toEqual([]);
	}, 120_000);
});
