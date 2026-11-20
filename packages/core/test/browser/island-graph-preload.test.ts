// PRELOAD AN ISLAND'S GRAPH AT WAKE (runtime/island-graph-preload.ts): the page's graph script lists
// each entry's chunks; `preload_island_graph(entry)` inserts one modulepreload per chunk not yet
// linked — only for that entry, only when called. End to end (the gate, a real build): e2e/wake-gate.
import { afterEach, beforeEach, describe, expect, inject, test } from 'vitest';
import {
	preload_island_graph,
	register_island_graph,
	reset_island_graph
} from '../../src/runtime/island-graph-preload.ts';
import { OGYGIA_GRAPH_PRELOAD as GRAPH_PRELOAD_ATTR } from '../../src/wire-markup.ts';
import { island_graph_script } from '../../src/server/document-tail.ts';
import { HAS, set_feature_word } from '../_stubs/boot.runtime-flags.ts';
import { F_GRAPH } from '../../src/contract/features.ts';
import { bootDev } from '../../src/runtime/full.ts';
import { from_b64 } from './b64.ts';

const ALL = HAS;

const ours = () =>
	[...document.head.querySelectorAll(`link[${GRAPH_PRELOAD_ATTR}]`)].map(
		(l) => new URL((l as HTMLLinkElement).href).pathname
	);

let host: HTMLElement;
beforeEach(() => {
	reset_island_graph();
	host = document.createElement('div');
	host.innerHTML = island_graph_script(
		new Map([
			['/g/a.js', ['/g/svelte.js', '/g/a-dep.js']],
			['/g/b.js', ['/g/svelte.js', '/g/b-dep.js']]
		])
	);
	document.body.append(host);
});
afterEach(() => {
	host.remove();
	document.head
		.querySelectorAll(`link[${GRAPH_PRELOAD_ATTR}], link[data-test-hint]`)
		.forEach((l) => l.remove());
});

test('nothing is linked until an island starts; then exactly its graph', () => {
	expect(ours()).toEqual([]);
	preload_island_graph('/g/a.js');
	expect(ours()).toEqual(['/g/svelte.js', '/g/a-dep.js']);
	for (const l of document.head.querySelectorAll(`link[${GRAPH_PRELOAD_ATTR}]`))
		expect((l as HTMLLinkElement).rel).toBe('modulepreload');
});

test('a shared chunk is linked once; a second island adds only its own', () => {
	preload_island_graph('/g/a.js');
	preload_island_graph('/g/b.js');
	preload_island_graph('/g/a.js');
	expect(ours()).toEqual(['/g/svelte.js', '/g/a-dep.js', '/g/b-dep.js']);
});

test('a chunk another loader linked after the first preload is not linked again (#984)', () => {
	preload_island_graph('/g/a.js');
	// (Vite's preload helper links a chunk of a dynamic import() later on)
	const link = document.createElement('link');
	link.rel = 'modulepreload';
	link.href = '/g/b-dep.js';
	link.setAttribute('data-test-hint', '');
	document.head.append(link);
	preload_island_graph('/g/b.js');
	const all = [...document.head.querySelectorAll('link[rel="modulepreload"]')].map(
		(l) => new URL((l as HTMLLinkElement).href).pathname
	);
	expect(all.filter((p) => p === '/g/b-dep.js')).toHaveLength(1);
});

test('a chunk the HTML already preloads is not linked again', () => {
	const link = document.createElement('link');
	link.rel = 'modulepreload';
	link.href = '/g/svelte.js';
	link.setAttribute('data-test-hint', '');
	document.head.append(link);
	preload_island_graph('/g/a.js');
	expect(ours()).toEqual(['/g/a-dep.js']);
});

test('an entry the page has no graph for links nothing', () => {
	preload_island_graph('/g/unknown.js');
	expect(ours()).toEqual([]);
});

test('a graph script added later (a router swap) is read on the next miss', () => {
	const late = document.createElement('div');
	late.innerHTML = island_graph_script(new Map([['/g/c.js', ['/g/c-dep.js']]]));
	document.body.append(late);
	preload_island_graph('/g/c.js');
	expect(ours()).toEqual(['/g/c-dep.js']);
	late.remove();
});

test('a graph read from another page resolves against that page (router warm)', () => {
	register_island_graph(
		JSON.stringify({ h: ['../chunks/x.js'], e: { './d.js': [0] } }),
		`${location.origin}/deep/page/`
	);
	preload_island_graph('/deep/page/d.js');
	expect(ours()).toEqual(['/deep/chunks/x.js']);
});

describe('a build whose word has no graph (no island code of the app can load: F_GRAPH off)', () => {
	afterEach(() => set_feature_word(ALL));

	test('reads no graph and links nothing, from the page or from another page', () => {
		set_feature_word(ALL & ~F_GRAPH);
		preload_island_graph('/g/a.js');
		register_island_graph(JSON.stringify({ h: ['/g/c-dep.js'], e: { '/g/c.js': [0] } }));
		preload_island_graph('/g/c.js');
		expect(ours()).toEqual([]);
		set_feature_word(ALL);
		preload_island_graph('/g/a.js');
		expect(ours(), 'the same page, with the bit: its graph').toEqual([
			'/g/svelte.js',
			'/g/a-dep.js'
		]);
	});

	test('an island it never saw still wakes: its import finds its chunks itself', async () => {
		set_feature_word(ALL & ~F_GRAPH);
		const box = document.createElement('div');
		box.innerHTML = from_b64(inject('counter_ssr_b64'));
		document.body.append(box);
		const region = box.querySelector('ogygia-region')!;
		bootDev();
		try {
			await expect.poll(() => region.hasAttribute('data-hydrated'), { timeout: 10_000 }).toBe(true);
			expect(ours()).toEqual([]);
		} finally {
			box.remove();
		}
	});
});
