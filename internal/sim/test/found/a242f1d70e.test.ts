// FOUND BY THE ALWAYS-ON SIMULATOR (seed 321549044, 40 actions, faults: delay,reorder,duplicate,redirect,stall).
// Signature a242f1d70e: page-errors. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: a242f1d70e', () => {
	it('seed 321549044 no longer finds page-errors a242f1d70e', async () => {
		const r = await run(321549044, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'a242f1d70e')).toEqual([]);
	}, 120_000);
});
