// FOUND BY THE ALWAYS-ON SIMULATOR (seed 691534395, 40 actions, faults: delay,reorder,duplicate,tamper).
// Signature 2dd330fdf3: page-errors. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 2dd330fdf3', () => {
	it('seed 691534395 no longer finds page-errors 2dd330fdf3', async () => {
		const r = await run(691534395, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '2dd330fdf3')).toEqual([]);
	}, 120_000);
});
