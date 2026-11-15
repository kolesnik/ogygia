// FOUND BY THE ALWAYS-ON SIMULATOR (seed 839730975, 40 actions, faults: drop,duplicate,stall).
// Signature c492078cc2: page-errors. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: c492078cc2', () => {
	it('seed 839730975 no longer finds page-errors c492078cc2', async () => {
		const r = await run(839730975, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'c492078cc2')).toEqual([]);
	}, 120_000);
});
