/**
 * A compiled definition's machines (what a production build runs for `$machine`): no state names,
 * so a state's key is its int: they move, wait and say their state by int; a definition read at
 * runtime keeps its names.
 */
import { describe, expect, test } from 'vitest';
import { graph, paths } from '../src/machine.ts';
import { STALE } from '../src/stale.ts';
import * as rt from '../src/run.ts';

// idle → armed → fetching → (idle | failed); failed → idle
const DEF = (): rt.Def => rt.compiled('hole', 4, 0, [2, 4, 9, 1]);
const make = (): rt.Run => rt.create(DEF() as never) as rt.Run;

describe('a compiled machine', () => {
	test('carries no names: each state’s key is its int, its steps those of its masks', () => {
		const def = DEF();
		expect(def.names).toBe(null);
		expect([...def.keys]).toEqual([0, 1, 2, 3]);
		expect(def.next.map((row) => Object.values(row))).toEqual([[1], [2], [0, 3], [0]]);
	});

	test('moves by int, and its kind and its now say the int', () => {
		const m = make();
		expect(m.kind).toBe(0);
		expect(m.go(1 as never)).toBe(true);
		expect(m.now).toEqual({ kind: 1 });
		expect(m.move(1 as never, 2 as never)).toBe(true);
		expect(m.move(1 as never, 2 as never)).toBe(false);
		expect(m.kind).toBe(2);
		expect(m.epoch).toBe(2);
	});

	test('a step not in its steps is refused with its states as ints', () => {
		const m = make();
		expect(() => m.go(2 as never)).toThrow(/machine_illegal_move\?name=hole&from=0&to=2/);
	});

	test('waits by int: the state when it comes, STALE when it no longer can', async () => {
		const m = make();
		const fetching = m.wait(2 as never);
		m.go(1 as never);
		m.go(2 as never);
		expect(await fetching).toEqual({ kind: 2 });
		const gone = rt.create(rt.compiled('end', 2, 0, [2, 0]) as never) as rt.Run;
		gone.go(1 as never);
		expect(await gone.wait(0 as never)).toBe(STALE);
	});

	test('has no graph or paths to draw: it has no names, as in a production build', () => {
		expect(() => graph(DEF())).toThrow(/machine_graph_off/);
		expect(() => paths(DEF())).toThrow(/machine_graph_off/);
	});

	test('in dev, a state given by name (a site the build did not compile) is refused', () => {
		const m = make();
		expect(() => m.go('armed' as never)).toThrow(/machine_illegal_move/);
		expect(() => m.move('idle' as never, 1 as never)).toThrow(/machine_illegal_move/);
		expect(() => m.wait('armed' as never)).toThrow(/machine_unknown_state/);
	});
});
