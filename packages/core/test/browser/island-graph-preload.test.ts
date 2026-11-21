// PRELOAD AN ISLAND'S GRAPH AT WAKE (runtime/island-graph-preload.ts): the page's graph script lists
// each entry's chunks; `preload_island_graph(entry)` inserts one modulepreload per chunk not yet
// linked — only for that entry, only when called. End to end (the gate, a real build): e2e/wake-gate.
import { afterEach, beforeEach, describe, expect, inject, test } from 'vitest';
import { Downloads } from '@ogygia/tooling/vitest/downloads';
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
import { boot_link, slots } from '../../src/runtime/slots.ts';
import { L_REGISTER_ISLAND_GRAPH } from '../../src/runtime/boot-link-index.ts';
import { link_boot } from '../../src/runtime/boot-link.ts';
import { warm_island_module } from '../../src/runtime/island-warm.ts';

const ALL = HAS;
const downloads = new Downloads();

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
	afterEach(() => {
		set_feature_word(ALL);
		slots.boot = null;
		bootDev();
	});

	/** The boot link a boot of the current word makes. */
	const relink = () => {
		slots.boot = null;
		link_boot();
		return boot_link();
	};

	test('its boot links a router read to no graph reader: a fetched page’s graph links nothing', () => {
		set_feature_word(ALL & ~F_GRAPH);
		relink()[L_REGISTER_ISLAND_GRAPH](
			JSON.stringify({ h: ['/g/c-dep.js'], e: { '/g/c.js': [0] } }),
			location.href
		);
		preload_island_graph('/g/c.js');
		expect(ours()).toEqual([]);
		set_feature_word(ALL);
		relink()[L_REGISTER_ISLAND_GRAPH](
			JSON.stringify({ h: ['/g/c-dep.js'], e: { '/g/c.js': [0] } }),
			location.href
		);
		preload_island_graph('/g/c.js');
		expect(ours(), 'with the bit: the graph a router read').toEqual(['/g/c-dep.js']);
	});

	test('a warm preloads no graph without the bit, and its graph with it', async () => {
		const requested = (part: string) => downloads.named(part);
		downloads.forget();
		const off = '/test/browser/fixtures/no-such-island.ts?t=graph-off';
		const on = '/test/browser/fixtures/no-such-island.ts?t=graph-on';
		register_island_graph(
			JSON.stringify({ h: ['/g/w-off-dep.js', '/g/w-on-dep.js'], e: { [off]: [0], [on]: [1] } }),
			location.href
		);
		set_feature_word(ALL & ~F_GRAPH);
		warm_island_module(off, undefined, 'user');
		await expect.poll(() => requested('t=graph-off').length, { timeout: 5000 }).toBe(1);
		expect(ours(), 'without the bit').toEqual([]);
		set_feature_word(ALL);
		warm_island_module(on, undefined, 'user');
		await expect.poll(() => ours(), { timeout: 5000 }).toEqual(['/g/w-on-dep.js']);
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
		} finally {
			box.remove();
		}
	});
});
