// `ogygia/no-macro-in-svelte` (./plugin.ts): ogygia's build-time macros are never written in a
// .svelte, .svelte.ts or .svelte.js file of package source, where nothing compiles them.
// Linted for real: a package file in a temporary tree, the repository's plugin.
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
	const dir = mkdtempSync(path.join(tmpdir(), 'og-no-macro-in-svelte-'));
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
				rules: { 'ogygia/no-macro-in-svelte': 'error' }
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
		return [...out.matchAll(/:(\d+):\d+: .*no-macro-in-svelte/g)].map((m) => Number(m[1]));
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

const MODULE = `export const check = $dev(function check(a: number) {
	return a;
});
const o = { $dev: 1 };
o.$dev;
const label = '$dev';
export async function f(t: Promise<number>) {
	return $await(t);
}
`;

test('a macro in a rune module is refused; a key, a member or a string is not one', () => {
	assert.deepEqual(reported('packages/demo/src/state.svelte.ts', MODULE), [1, 8]);
	assert.deepEqual(reported('packages/demo/src/state.svelte.js', 'export const a = $dev;\n'), [1]);
});

test('a macro in a component is refused (there it would read a store)', () => {
	const component = `<script lang="ts">
	const a = 1;
	$dev(a);
</script>
`;
	assert.deepEqual(reported('packages/demo/src/A.svelte', component), [3]);
});

test('a plain .ts file and a file outside package source are not linted', () => {
	assert.deepEqual(reported('packages/demo/src/state.ts', MODULE), []);
	assert.deepEqual(reported('apps/demo/src/state.svelte.ts', MODULE), []);
});
