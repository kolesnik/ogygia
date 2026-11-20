// FOUND BY THE ALWAYS-ON SIMULATOR (seed 68356952, 40 actions, faults: reorder,tamper,redirect).
// Signature 7f78ce500d: ssr-hydrate. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 7f78ce500d', () => {
	it('seed 68356952 no longer finds ssr-hydrate 7f78ce500d', async () => {
		const r = await run(68356952, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '7f78ce500d')).toEqual([]);
	}, 120_000);
});
