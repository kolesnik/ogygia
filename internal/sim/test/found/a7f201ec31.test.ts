// FOUND BY THE ALWAYS-ON SIMULATOR (seed 610517516, 40 actions, faults: reorder,drop,tamper).
// Signature a7f201ec31: page-errors. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: a7f201ec31', () => {
	it('seed 610517516 no longer finds page-errors a7f201ec31', async () => {
		const r = await run(610517516, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'a7f201ec31')).toEqual([]);
	}, 120_000);
});
