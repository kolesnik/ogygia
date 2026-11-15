// FOUND BY THE ALWAYS-ON SIMULATOR (seed 839731389, 40 actions, faults: cut).
// Signature 998a403528: mpa-equivalence. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 998a403528', () => {
	it('seed 839731389 no longer finds mpa-equivalence 998a403528', async () => {
		const r = await run(839731389, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '998a403528')).toEqual([]);
	}, 120_000);
});
