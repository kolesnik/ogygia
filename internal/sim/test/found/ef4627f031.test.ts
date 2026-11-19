// FOUND BY THE ALWAYS-ON SIMULATOR (seed 610517457, 40 actions, faults: delay,reorder,duplicate,cut,tamper,stall).
// Signature ef4627f031: waste. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: ef4627f031', () => {
	it('seed 610517457 no longer finds waste ef4627f031', async () => {
		const r = await run(610517457, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'ef4627f031')).toEqual([]);
	}, 120_000);
});
