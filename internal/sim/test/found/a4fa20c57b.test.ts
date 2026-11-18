// FOUND BY THE ALWAYS-ON SIMULATOR (seed 302061542, 40 actions, faults: delay,reorder,duplicate,stall).
// Signature a4fa20c57b: mpa-equivalence. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: a4fa20c57b', () => {
	it('seed 302061542 no longer finds mpa-equivalence a4fa20c57b', async () => {
		const r = await run(302061542, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'a4fa20c57b')).toEqual([]);
	}, 120_000);
});
