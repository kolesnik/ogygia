// FOUND BY THE ALWAYS-ON SIMULATOR (seed 753961639, 40 actions, faults: delay,tamper,redirect,stall).
// Signature 5457316c04: uncaught. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 5457316c04', () => {
	it('seed 753961639 no longer finds uncaught 5457316c04', async () => {
		const r = await run(753961639, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '5457316c04')).toEqual([]);
	}, 120_000);
});
