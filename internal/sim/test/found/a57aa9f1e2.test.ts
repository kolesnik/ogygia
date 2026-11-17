// FOUND BY THE ALWAYS-ON SIMULATOR (seed 753963111, 40 actions, faults: redirect,stall).
// Signature a57aa9f1e2: outage-recovery. Written by src/ci.ts; shrink it by hand, then say the behaviour in its name.
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { run } from '../../src/cli.ts';
import { signature } from '../../src/ci.ts';

const built = existsSync(
	fileURLToPath(new URL('../../../../apps/palaestra/.svelte-kit/output/server/index.js', import.meta.url))
);

describe.skipIf(!built)('found: a57aa9f1e2', () => {
	it('seed 753963111 no longer finds outage-recovery a57aa9f1e2', async () => {
		const r = await run(753963111, 40);
		expect(r.broken.filter((b) => b.oracle !== 'known' && signature(b) === 'a57aa9f1e2')).toEqual([]);
	}, 120_000);
});
