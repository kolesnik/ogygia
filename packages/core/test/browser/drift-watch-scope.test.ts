// The drift watcher looks at the sleeping islands only, never the whole document: on a large page
// every mutation anywhere (Kit's hydration, a web component rendering its light DOM) ran its callback.
// A spy MutationObserver, installed before the module makes its one observer, records what it watches
// and how often its callback runs.
import { afterEach, expect, it } from 'vitest';
import { life_of } from '@ogygia/machine/internal';
import { scope } from '@ogygia/machine';
import { region_changed, watch_region } from '../../src/runtime/drift-watch.ts';

const targets: Node[] = [];
let calls = 0;
let observes = 0;
const Native = MutationObserver;
globalThis.MutationObserver = class extends Native {
	constructor(cb: MutationCallback) {
		super((records, observer) => {
			calls++;
			cb(records, observer);
		});
	}
	observe(target: Node, options?: MutationObserverInit) {
		targets.push(target);
		observes++;
		super.observe(target, options);
	}
};

const made: Element[] = [];
afterEach(() => {
	for (const el of made.splice(0)) el.remove();
});

function region(html: string): HTMLElement {
	const el = document.createElement('ogygia-region');
	el.innerHTML = html;
	document.body.append(el);
	made.push(el);
	return el;
}

const tick = () => new Promise((r) => setTimeout(r, 0));

it('a sleeping island is watched on its own subtree, not the whole document', () => {
	const r = region('<p>asleep</p>');
	const sleep = scope();
	targets.length = 0;
	watch_region(life_of(sleep), r);
	expect(targets).toEqual([r]);
	sleep.close();
});

it('a mutation outside every sleeping island does not run the watcher', async () => {
	const r = region('<p>asleep</p>');
	const page = document.createElement('div');
	document.body.append(page);
	made.push(page);
	const sleep = scope();
	watch_region(life_of(sleep), r);
	calls = 0;
	for (let i = 0; i < 50; i++) page.append(document.createElement('span'));
	await tick();
	expect(calls).toBe(0);
	r.querySelector('p')!.firstChild!.nodeValue = 'touched';
	expect(region_changed(r)).toBe(true);
	sleep.close();
});

it('an island that woke is no longer watched while another still sleeps', async () => {
	const woke = region('<p>a</p>');
	const asleep = region('<p>b</p>');
	const first = scope();
	const second = scope();
	watch_region(life_of(first), woke);
	watch_region(life_of(second), asleep);
	first.close();
	calls = 0;
	woke.append(document.createElement('span'));
	await tick();
	expect(calls).toBe(0);
	asleep.append(document.createElement('span'));
	expect(region_changed(asleep)).toBe(true);
	second.close();
});

it('regions waking one by one cost a bounded number of observe calls each, not one per sleeper per wake', () => {
	const n = 100;
	const regions = Array.from({ length: n }, (_, i) => region(`<p>${i}</p>`));
	const sleeps = regions.map(() => scope());
	observes = 0;
	regions.forEach((r, i) => watch_region(life_of(sleeps[i]!), r));
	for (const sleep of sleeps) sleep.close();
	expect(observes).toBeLessThanOrEqual(3 * n);
});

it('while many still sleep, a change in an island that woke does not mark it, and the sleepers stay watched', () => {
	const regions = Array.from({ length: 10 }, (_, i) => region(`<p>${i}</p>`));
	const sleeps = regions.map(() => scope());
	regions.forEach((r, i) => watch_region(life_of(sleeps[i]!), r));
	regions[0]!.append(document.createElement('span'));
	sleeps[0]!.close();
	expect(region_changed(regions[0]!)).toBe(true);
	sleeps[1]!.close();
	regions[1]!.append(document.createElement('i'));
	const again = scope();
	watch_region(life_of(again), regions[1]!);
	expect(region_changed(regions[1]!)).toBe(false);
	regions[9]!.firstChild!.firstChild!.nodeValue = 'touched';
	expect(region_changed(regions[9]!)).toBe(true);
	expect(region_changed(regions[8]!)).toBe(false);
	again.close();
	for (const sleep of sleeps) sleep.close();
});
