// `ogygia/downloads-heard` (./plugin.ts): a test reads the downloads it checks from an observer
// (@ogygia/tooling/vitest/downloads), never from the page's resource timeline, which keeps 250
// entries. A dev run's frame filled it: hydrate-visit's wait for its island's download timed out in
// 3 of 6 full core-browser runs, and entry-location-hydrate's "never asked" check passed without
// looking. Linted for real: a test file in a temporary tree, the repository's plugin.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '../..');
const OXLINT = path.join(ROOT, 'node_modules/.bin/oxlint');

/** The lines of `source`, as `rel` in a package tree, the rule reports. */
function reported(rel: string, source: string): number[] {
	const dir = mkdtempSync(path.join(tmpdir(), 'og-downloads-heard-'));
	try {
		const file = path.join(dir, rel);
		mkdirSync(path.dirname(file), { recursive: true });
		writeFileSync(file, source);
		const config = path.join(dir, '.oxlintrc.json');
		writeFileSync(
			config,
			JSON.stringify({
				plugins: ['typescript'],
				jsPlugins: [path.join(ROOT, 'internal/lint/plugin.ts')],
				rules: { 'ogygia/downloads-heard': 'error' }
			})
		);
		let out = '';
		try {
			out = execFileSync(OXLINT, ['-c', config, '--format', 'unix', file], {
				cwd: dir,
				encoding: 'utf8'
			});
		} catch (e) {
			out = String((e as { stdout?: string }).stdout ?? '');
		}
		return [...out.matchAll(/:(\d+):\d+: .*downloads-heard/g)].map((m) => Number(m[1]));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const SOURCE = `const a = performance.getEntriesByType('resource');
const b = performance.getEntriesByName('/x.js');
performance.clearResourceTimings();
performance.setResourceTimingBufferSize(10);
const kind = 'resource';
const c = performance.getEntriesByType(kind);
const nav = performance.getEntriesByType('navigation');
const paint = performance.getEntriesByType('paint');
const t = performance.now();
const real = performance.getEntriesByName.bind(performance);
const mock = { setResourceTimingBufferSize() {} };
const other = timeline.getEntriesByType('resource');
`;

test("a test's read of the resource timeline is refused; other entry types and a mock are not", () => {
	assert.deepEqual(reported('packages/demo/test/browser/a.test.ts', SOURCE), [1, 2, 3, 4, 6]);
});

test('source, which reads the timeline beside an observer of its own, is not a test file', () => {
	assert.deepEqual(reported('packages/demo/src/runtime/a.ts', SOURCE), []);
});
