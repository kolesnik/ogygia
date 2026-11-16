// FOUND BY THE ALWAYS-ON SIMULATOR (seed 320517053, 40 actions, faults: reorder,duplicate,tamper,redirect,stall).
// Signature 4c46b3b305: outage-recovery. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 4c46b3b305', () => {
	it('seed 320517053 no longer finds outage-recovery 4c46b3b305', async () => {
		const r = await run(320517053, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '4c46b3b305')).toEqual([]);
	}, 120_000);
});
