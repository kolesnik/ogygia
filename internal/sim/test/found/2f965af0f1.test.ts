// FOUND BY THE ALWAYS-ON SIMULATOR (seed 320518128, 40 actions, faults: reorder,cut,stall).
// Signature 2f965af0f1: outage-recovery. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 2f965af0f1', () => {
	it('seed 320518128 no longer finds outage-recovery 2f965af0f1', async () => {
		const r = await run(320518128, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '2f965af0f1')).toEqual([]);
	}, 120_000);
});
