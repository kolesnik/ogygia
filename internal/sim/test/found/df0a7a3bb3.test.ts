// FOUND BY THE ALWAYS-ON SIMULATOR (seed 68356198, 40 actions, faults: drop,tamper).
// Signature df0a7a3bb3: page-errors. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: df0a7a3bb3', () => {
	it('seed 68356198 no longer finds page-errors df0a7a3bb3', async () => {
		const r = await run(68356198, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'df0a7a3bb3')).toEqual([]);
	}, 120_000);
});
