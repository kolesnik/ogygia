// FOUND BY THE ALWAYS-ON SIMULATOR (seed 691534020, 40 actions, faults: delay,reorder,duplicate,tamper,redirect).
// Signature dbd74fe420: page-errors. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: dbd74fe420', () => {
	it('seed 691534020 no longer finds page-errors dbd74fe420', async () => {
		const r = await run(691534020, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'dbd74fe420')).toEqual([]);
	}, 120_000);
});
