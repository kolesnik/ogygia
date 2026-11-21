import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { heisenbench_dir, link_heisenbench, REPO_ROOT } from '../src/heisenbench.ts';

const PRELOAD = fileURLToPath(new URL('../src/preload.ts', import.meta.url));
const CORE_TEST = new URL('../../../packages/core/test/', import.meta.url).href;

function run(code: string): string {
	return execFileSync(
		process.execPath,
		['--import', PRELOAD, '--input-type=module', '--eval', code],
		{ encoding: 'utf8' }
	);
}

test('the region bench renders Region for real, not a thrown $derived', () => {
	const out = run(`
		const { server_out } = await import('${CORE_TEST}_region-grid-server.ts');
		const { cases_of, props_for } = await import('${CORE_TEST}_region-grid.ts');
		const place = { at: 'page', kit: 'pass', csr: 'off', page: 'ok', env: 'prod' };
		for (const kind of ['island', 'hole', 'lake', 'deferred']) {
			const c = cases_of(kind)[0];
			console.log(server_out(c, place, () => [props_for(c)], false).text);
		}
	`);
	assert.match(out, /<!-- body -->[^\n]/);
	assert.doesNotMatch(out, /<!-- thrown -->[^\n]/);
	assert.doesNotMatch(out, /is not defined/);
});

/** `heisenbench run` of `files` (in order; a bare name is one of ./fixtures) in one process, with
 *  the preload, and `args`: what it said. */
function bench_run(files: readonly string[], ...args: string[]): string {
	const engine = heisenbench_dir();
	link_heisenbench(engine);
	const out = mkdtempSync(join(tmpdir(), 'og-preload-'));
	const r = spawnSync(
		process.execPath,
		[
			'--import',
			PRELOAD,
			join(engine, 'src', 'cli.ts'),
			'run',
			...files.map((f) =>
				f.includes('/') ? f : fileURLToPath(new URL(`./fixtures/${f}`, import.meta.url))
			),
			'--root',
			REPO_ROOT,
			'--out',
			join(out, 'run.json'),
			...args
		],
		{ encoding: 'utf8', cwd: REPO_ROOT }
	);
	return `${r.stdout}${r.stderr}`;
}

test("a bench that reaches core's built runes modules (.svelte.js) runs: Heisenbench compiles them, once", () => {
	const said = bench_run(['built-runes.bench.ts']);
	assert.doesNotMatch(said, /FAILED/);
	assert.match(said, /^ok\s+a built runes module/m);
});

test("each bench file of a run loads in Node's own world: a browser an earlier file installed is gone", () => {
	const said = bench_run(['world-browser.bench.ts', 'world-server.bench.ts']);
	assert.doesNotMatch(said, /FAILED/);
	assert.match(said, /^ok\s+a file that installs a browser runs in it/m);
	assert.match(said, /^ok\s+a later file loads in Node's own world/m);
});

test("core's bench cases that hear the page's downloads count the same on every run", () => {
	const runtime = fileURLToPath(
		new URL('../../../packages/core/bench/runtime.bench.ts', import.meta.url)
	);
	const said = bench_run([runtime], '--filter', 'import_again: chunks that failed to download');
	assert.doesNotMatch(said, /UNSTABLE|FAILED/);
	assert.match(said, /^ok\s+import_again: chunks that failed to download/m);
});
