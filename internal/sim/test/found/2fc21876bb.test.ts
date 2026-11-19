// FOUND BY THE ALWAYS-ON SIMULATOR (seed 610518297, 40 actions, faults: drop,duplicate,cut,redirect).
// Signature 2fc21876bb: uncaught. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 2fc21876bb', () => {
	it('seed 610518297 no longer finds uncaught 2fc21876bb', async () => {
		const r = await run(610518297, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '2fc21876bb')).toEqual([]);
	}, 120_000);
});
