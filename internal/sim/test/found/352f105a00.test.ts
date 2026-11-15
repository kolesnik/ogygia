// FOUND BY THE ALWAYS-ON SIMULATOR (seed 208641442, 40 actions, faults: delay,drop,cut,stall).
// Signature 352f105a00: paint-gate. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 352f105a00', () => {
	it('seed 208641442 no longer finds paint-gate 352f105a00', async () => {
		const r = await run(208641442, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '352f105a00')).toEqual([]);
	}, 120_000);
});
