// FOUND BY THE ALWAYS-ON SIMULATOR (seed 321550650, 40 actions, faults: duplicate,cut,stall).
// Signature 260c1394b3: mpa-equivalence. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 260c1394b3', () => {
	it('seed 321550650 no longer finds mpa-equivalence 260c1394b3', async () => {
		const r = await run(321550650, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '260c1394b3')).toEqual([]);
	}, 120_000);
});
