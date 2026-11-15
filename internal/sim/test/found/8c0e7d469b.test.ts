// FOUND BY THE ALWAYS-ON SIMULATOR (seed 208640584, 40 actions, faults: cut,tamper).
// Signature 8c0e7d469b: mpa-equivalence. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 8c0e7d469b', () => {
	it('seed 208640584 no longer finds mpa-equivalence 8c0e7d469b', async () => {
		const r = await run(208640584, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '8c0e7d469b')).toEqual([]);
	}, 120_000);
});
