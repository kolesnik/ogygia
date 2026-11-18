// FOUND BY THE ALWAYS-ON SIMULATOR (seed 824072722, 40 actions, faults: drop,stall).
// Signature d23ff54919: mpa-equivalence. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: d23ff54919', () => {
	it('seed 824072722 no longer finds mpa-equivalence d23ff54919', async () => {
		const r = await run(824072722, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'd23ff54919')).toEqual([]);
	}, 120_000);
});
