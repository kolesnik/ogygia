/**
 * The machine primitives: names to numbers, the dense transition table, groups as bitmasks, the
 * pairs nobody decided, and the states no path reaches.
 */
import { describe, expect, test } from 'vitest';
import {
	REFUSED,
	UNDECIDED,
	bitsets,
	enumerate,
	exhaustive,
	reachable,
	transitions
} from '../src/machine.ts';

const states = enumerate(['idle', 'pressed', 'active', 'lost']);
const events = enumerate(['down', 'move', 'up']);

describe('machine primitives', () => {
	test('enumerate numbers names in order and refuses a name twice', () => {
		expect(states.of('active')).toBe(2);
		expect(states.size).toBe(4);
		expect(() => enumerate(['a', 'a'])).toThrow('enumerate: "a" is named twice.');
		expect(() => states.of('gone' as never)).toThrow('enumerate: no "gone".');
	});

	test('transitions is dense: a number, refused, or not decided', () => {
		const table = transitions(states, events, (s, e) =>
			s === 'idle' && e === 'down'
				? 'pressed'
				: s === 'pressed' && e === 'move'
					? 'active'
					: s === 'active' && e === 'up'
						? 'idle'
						: s === 'lost'
							? undefined
							: null
		);
		expect(table.rows).toEqual([
			[1, REFUSED, REFUSED],
			[REFUSED, 2, REFUSED],
			[REFUSED, REFUSED, 0],
			[UNDECIDED, UNDECIDED, UNDECIDED]
		]);
		expect(exhaustive(table)).toEqual([
			['lost', 'down'],
			['lost', 'move'],
			['lost', 'up']
		]);
		expect(reachable(table, 'idle')).toEqual({
			reached: new Set([0, 1, 2]),
			dead: ['lost']
		});
	});

	test('bitsets: each group one mask; more than 31 states is an error', () => {
		expect(bitsets(states, [['pressed', 'active'], ['idle'], []])).toEqual([6, 1, 0]);
		const many = enumerate(Array.from({ length: 32 }, (_, i) => `s${i}`));
		expect(() => bitsets(many, [])).toThrow('bitsets: 32 states; a mask holds 31.');
	});
});
