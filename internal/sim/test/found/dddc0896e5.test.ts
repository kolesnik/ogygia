// FOUND BY THE ALWAYS-ON SIMULATOR (seed 346200287, 40 actions, faults: delay,reorder,duplicate,stall).
// Signature dddc0896e5: mpa-equivalence. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: dddc0896e5', () => {
	it('seed 346200287 no longer finds mpa-equivalence dddc0896e5', async () => {
		const r = await run(346200287, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'dddc0896e5')).toEqual([]);
	}, 120_000);
});
