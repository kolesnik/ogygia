// FOUND BY THE ALWAYS-ON SIMULATOR (seed 691534585, 40 actions, faults: tamper,redirect).
// Signature f3c2586801: page-errors. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: f3c2586801', () => {
	it('seed 691534585 no longer finds page-errors f3c2586801', async () => {
		const r = await run(691534585, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'f3c2586801')).toEqual([]);
	}, 120_000);
});
