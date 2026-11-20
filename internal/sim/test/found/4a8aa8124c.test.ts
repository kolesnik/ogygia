// FOUND BY THE ALWAYS-ON SIMULATOR (seed 231920983, 40 actions, faults: redirect,stall).
// Signature 4a8aa8124c: mpa-equivalence. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 4a8aa8124c', () => {
	it('seed 231920983 no longer finds mpa-equivalence 4a8aa8124c', async () => {
		const r = await run(231920983, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '4a8aa8124c')).toEqual([]);
	}, 120_000);
});
