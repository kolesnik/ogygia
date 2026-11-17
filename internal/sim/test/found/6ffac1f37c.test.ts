// FOUND BY THE ALWAYS-ON SIMULATOR (seed 997733150, 40 actions, faults: cut,tamper,redirect,stall).
// Signature 6ffac1f37c: mpa-equivalence. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 6ffac1f37c', () => {
	it('seed 997733150 no longer finds mpa-equivalence 6ffac1f37c', async () => {
		const r = await run(997733150, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '6ffac1f37c')).toEqual([]);
	}, 120_000);
});
