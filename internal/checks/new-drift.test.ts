// node --test internal/checks/new-drift.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { drift_findings } from './new-drift.ts';

const A = 'packages/core/src/runtime/a.ts';
const lines = (...rows: string[]) => new Map(rows.map((t, i) => [i + 1, t]));

test('an added await of a task or a wait drifts once $await is built, not before', () => {
	const added = new Map([
		[A, lines('const v = await m.scope.task(() => f());', 'const x = await fetch(u);')]
	]);
	assert.deepEqual(drift_findings(added, []), []);
	assert.deepEqual(
		drift_findings(added, ['$await']).map((f) => [f.line, f.macro]),
		[[1, '$await']]
	);
});

test('a hand-gated dev or rules call drifts once its macro is built', () => {
	const added = new Map([
		[
			A,
			lines(
				'if (import.meta.env.DEV) check_slot(x);',
				'if (RULES) check_rules(y);',
				'if (import.meta.env.DEV) {'
			)
		]
	]);
	assert.deepEqual(
		drift_findings(added, ['$dev', '$rules']).map((f) => [f.line, f.macro]),
		[
			[1, '$dev'],
			[2, '$rules']
		]
	);
});

test('only plain TypeScript of core source is read: a Svelte module or another package passes', () => {
	const by_hand = lines('const v = await m.wait("idle");');
	const added = new Map([
		['packages/core/src/runtime/a.svelte.ts', by_hand],
		['packages/router/src/a.ts', by_hand],
		['packages/core/test/a.test.ts', by_hand]
	]);
	assert.deepEqual(drift_findings(added, ['$await']), []);
});
