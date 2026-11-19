// FOUND BY THE ALWAYS-ON SIMULATOR (seed 346199490, 40 actions, faults: drop,cut,tamper).
// Signature 6ac8849d58: html-kept. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 6ac8849d58', () => {
	it('seed 346199490 no longer finds html-kept 6ac8849d58', async () => {
		const r = await run(346199490, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '6ac8849d58')).toEqual([]);
	}, 120_000);
});
