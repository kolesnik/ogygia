// FOUND BY THE ALWAYS-ON SIMULATOR (seed 783825139, 40 actions, faults: redirect,stall).
// Signature f92b8ce3c6: mpa-equivalence. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: f92b8ce3c6', () => {
	it('seed 783825139 no longer finds mpa-equivalence f92b8ce3c6', async () => {
		const r = await run(783825139, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'f92b8ce3c6')).toEqual([]);
	}, 120_000);
});
