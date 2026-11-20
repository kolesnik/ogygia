// THE GRAPH FEATURE (link/runtime-entry.ts `graph`): the island graph's reader (core
// runtime/island-graph-preload.ts) ships only where some island's code can load on the page: a
// waking island, a held region (its wake is a runtime value), a peer's or a client plugin's regions.
// A page of lakes and holes with no island in them loads no island code, so it reads no graph (core
// test/browser/island-graph-preload.test.ts: without it an island still wakes, its import finding its
// chunks itself).
import { describe, expect, test } from 'vitest';
import {
	generateRuntimeFlagsSource,
	resolveFeatures,
	type RuntimeMarks
} from '../src/link/runtime-entry.ts';
import { F_GRAPH } from '@ogygia/core/contract';

const marks = (m: Partial<RuntimeMarks>): RuntimeMarks => ({ complete: true, ...m });
const has_graph = (m: Partial<RuntimeMarks>): boolean =>
	resolveFeatures(marks(m)).includes('graph');

describe('the graph ships where island code can load', () => {
	test.each<[string, Partial<RuntimeMarks>]>([
		['a waking island', { hydrate: ['load'] }],
		['an island woken by a gesture', { hydrate: ['interaction'] }],
		['an island beside lakes', { hydrate: ['none', 'idle'], lakes: true }],
		["a held region (region()'s wake is a runtime value)", { live: true }],
		["a peer's regions (federation)", { foreign: true }],
		["a client plugin's", { clientPlugins: true }]
	])('%s', (_, m) => {
		expect(has_graph(m)).toBe(true);
	});

	test.each<[string, Partial<RuntimeMarks>]>([
		['a page of lakes only', { hydrate: ['none'], lakes: true }],
		['holes with no island in them', { defer: ['load', 'idle'] }],
		['no region at all', {}]
	])('and not with %s', (_, m) => {
		expect(has_graph(m)).toBe(false);
	});

	test("the word holds the graph's bit exactly when it ships, and always without marks", () => {
		const word = (m: RuntimeMarks, all = false) =>
			Number(/HAS = (\d+);/.exec(generateRuntimeFlagsSource(m, '/rt', all))![1]);
		expect(word(marks({ hydrate: ['load'] })) & F_GRAPH).toBe(F_GRAPH);
		expect(word(marks({ hydrate: ['none'], lakes: true })) & F_GRAPH).toBe(0);
		expect(word({}, true) & F_GRAPH).toBe(F_GRAPH);
		expect(resolveFeatures({ complete: false })).toContain('graph');
	});
});
