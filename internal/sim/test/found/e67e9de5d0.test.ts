// FOUND BY THE ALWAYS-ON SIMULATOR (seed 610517457, 40 actions, faults: delay,reorder,duplicate,cut,tamper,stall).
// Signature e67e9de5d0: mpa-equivalence. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: e67e9de5d0', () => {
	it('seed 610517457 no longer finds mpa-equivalence e67e9de5d0', async () => {
		const r = await run(610517457, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'e67e9de5d0')).toEqual([]);
	}, 120_000);
});
