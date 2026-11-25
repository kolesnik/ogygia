import { describe, expect, test } from 'vitest';
import { pathTo, type Graph } from '../src/reach.ts';

const edges: Record<string, Array<string>> = {
	a: ['b', 'c'],
	b: ['d'],
	c: ['e'],
	d: ['x'],
	e: ['x'],
	f: ['x'],
	x: []
};

const graph = (
	targets: ReadonlyArray<string>,
	closed: ReadonlyArray<string> = []
): Graph<string> => ({
	key: (n) => n,
	next: (n) => edges[n] ?? [],
	found: (n) => targets.includes(n),
	crosses: (n) => !closed.includes(n)
});

describe('pathTo', () => {
	test('the shortest path to the first target, start first', () => {
		expect(pathTo('a', graph(['x']))).toEqual(['a', 'b', 'd', 'x']);
		expect(pathTo('a', graph(['e', 'x']))).toEqual(['a', 'c', 'e']);
	});

	test('none reachable, or only past a node the walk may not cross', () => {
		expect(pathTo('a', graph(['f']))).toBeNull();
		expect(pathTo('a', graph(['x'], ['b', 'c']))).toBeNull();
		expect(pathTo('a', graph(['x'], ['b']))).toEqual(['a', 'c', 'e', 'x']);
	});

	test('a cycle ends', () => {
		const loop: Graph<string> = {
			key: (n) => n,
			next: (n) => (n === 'p' ? ['q'] : ['p']),
			found: () => false
		};
		expect(pathTo('p', loop)).toBeNull();
	});
});
