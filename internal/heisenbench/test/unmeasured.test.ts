import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REPO_ROOT } from '../src/heisenbench.ts';

const GATE = fileURLToPath(new URL('../src/unmeasured.ts', import.meta.url));

/** The gate's inventory ids (`--ids-only`: no bench or test run). */
function inventory_ids(): string[] {
	const out = mkdtempSync(join(tmpdir(), 'og-gate-'));
	const run = spawnSync(process.execPath, [GATE, '--ids-only', '--out', relative(REPO_ROOT, out)], {
		cwd: REPO_ROOT,
		encoding: 'utf8'
	});
	assert.equal(run.status, 0, `the gate failed:\n${run.stderr}`);
	const inventory = JSON.parse(readFileSync(join(out, 'inventory.json'), 'utf8')) as {
		functions: { id: string }[];
	};
	return inventory.functions.map((f) => f.id);
}

test("the gate names a core file's functions as its macros compile them: the code its benches and tests run", () => {
	const ids = inventory_ids();
	const RULES = 'packages/core/src/runtime/rules.ts > ';
	const SCHEDULER = 'packages/core/src/runtime/load-scheduler.ts > LoadScheduler > #open_line > ';
	// `$rules(function note_mount …)` runs as `note_mount`
	assert.ok(ids.includes(`${RULES}note_mount`));
	assert.ok(!ids.some((id) => id.startsWith(`${RULES}$rules:`)));
	// a maker call the build checked runs as its trusted maker
	assert.ok(ids.includes(`${SCHEDULER}trustedPassQueue:0~e6e564 > holds`));
	assert.ok(!ids.some((id) => id.startsWith(`${SCHEDULER}passQueue:`)));
	// each id names the source file, never its mirror
	assert.ok(!ids.some((id) => id.includes('.heisenbench/')));
});
