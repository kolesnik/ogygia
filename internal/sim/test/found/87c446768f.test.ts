// FOUND BY THE ALWAYS-ON SIMULATOR (seed 321550402, 40 actions, faults: delay,duplicate,cut,tamper,redirect).
// Signature 87c446768f: stuck. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: 87c446768f', () => {
	it('seed 321550402 no longer finds stuck 87c446768f', async () => {
		const r = await run(321550402, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === '87c446768f')).toEqual([]);
	}, 120_000);
});
