// FOUND BY THE ALWAYS-ON SIMULATOR (seed 208640329, 40 actions, faults: delay,reorder,cut,tamper,stall).
// Signature 5204d023cb: page-errors. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 5204d023cb', () => {
	it('seed 208640329 no longer finds page-errors 5204d023cb', async () => {
		const r = await run(208640329, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '5204d023cb')).toEqual([]);
	}, 120_000);
});
