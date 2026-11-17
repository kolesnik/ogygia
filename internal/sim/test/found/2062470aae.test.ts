// FOUND BY THE ALWAYS-ON SIMULATOR (seed 997733006, 40 actions, faults: reorder,duplicate).
// Signature 2062470aae: outage-recovery. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 2062470aae', () => {
	it('seed 997733006 no longer finds outage-recovery 2062470aae', async () => {
		const r = await run(997733006, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '2062470aae')).toEqual([]);
	}, 120_000);
});
