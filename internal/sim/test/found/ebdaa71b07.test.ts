// FOUND BY THE ALWAYS-ON SIMULATOR (seed 783827205, 40 actions, faults: delay,stall).
// Signature ebdaa71b07: waste. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: ebdaa71b07', () => {
	it('seed 783827205 no longer finds waste ebdaa71b07', async () => {
		const r = await run(783827205, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'ebdaa71b07')).toEqual([]);
	}, 120_000);
});
