// FOUND BY THE ALWAYS-ON SIMULATOR (seed 320519035, 40 actions, faults: reorder,drop,stall).
// Signature e4d33210c9: page-errors. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: e4d33210c9', () => {
	it('seed 320519035 no longer finds page-errors e4d33210c9', async () => {
		const r = await run(320519035, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'e4d33210c9')).toEqual([]);
	}, 120_000);
});
