// FOUND BY THE ALWAYS-ON SIMULATOR (seed 208641268, 40 actions, faults: delay,reorder,redirect,stall).
// Signature a2f61d6b80: page-errors. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: a2f61d6b80', () => {
	it('seed 208641268 no longer finds page-errors a2f61d6b80', async () => {
		const r = await run(208641268, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'a2f61d6b80')).toEqual([]);
	}, 120_000);
});
