import { describe, expect, it } from 'vitest';
import { cache, MachineError, scope } from '../src/index.ts';
import { lru } from '../src/internal.ts';
import { DISPOSE } from './_dispose.ts';

/** A small seeded generator: the same walk on every run. */
function seeded(seed: number): (n: number) => number {
	let s = seed;
	return (n) => (s = (s * 1103515245 + 12345) % 2 ** 31) % n;
}

const KEYS: readonly unknown[] = ['a', 'b', 'c', 'd', 'e', undefined, 0, 1];
const VALUES: readonly unknown[] = [1, 2, undefined, 'x', null];

describe('lru: cache() with only a max, and nothing else', () => {
	for (const max of [0.5, 1, 2, 2.5, 3, 7])
		it(`answers every call as cache({ max: ${max} }) does, through a seeded walk`, () => {
			for (let seed = 1; seed <= 20; seed++) {
				const next = seeded(seed);
				const owner_a = scope();
				const owner_b = scope();
				const owned = seed % 2 === 0;
				const a = cache<unknown, unknown>({ max, owner: owned ? owner_a : undefined });
				const b = lru<unknown, unknown>({ max, owner: owned ? owner_b : undefined });
				for (let step = 0; step < 120; step++) {
					const key = KEYS[next(KEYS.length)];
					const value = VALUES[next(VALUES.length)];
					const op = next(100);
					const call = (c: typeof a | typeof b): unknown => {
						if (op < 30) return c.set(key, value);
						if (op < 50) return c.get(key);
						if (op < 60) return c.peek(key);
						if (op < 70) return c.has(key);
						if (op < 80) return c.delete(key);
						if (op < 82) return c.clear();
						if (op === 82 && owned) return c[DISPOSE]();
						return c.entries();
					};
					if (op === 82 && owned && seed % 4 === 0) {
						owner_a.close();
						owner_b.close();
					} else expect(call(b)).toEqual(call(a));
					expect(b.entries()).toEqual(a.entries());
					expect(b.size).toBe(a.size);
					expect(b.size).toBe(a.weight);
				}
			}
		});

	it('a key holding undefined is held, and a get of it is a use, as in cache()', () => {
		for (const c of [cache<string, unknown>({ max: 2 }), lru<string, unknown>({ max: 2 })]) {
			c.set('a', undefined);
			c.set('b', 1);
			expect(c.has('a')).toBe(true);
			c.get('a');
			c.set('c', 2);
			expect(c.entries()).toEqual([
				['a', undefined],
				['c', 2]
			]);
		}
	});

	it('refuses a max that is no bound, as cache() does', () => {
		for (const max of [0, -1, Infinity, Number.NaN, '3' as never]) {
			expect(() => lru({ max })).toThrow(MachineError);
			expect(() => cache({ max })).toThrow(MachineError);
		}
	});

	it('keeps nothing once its owner ended, or once disposed', () => {
		const owner = scope();
		const owned = lru<string, number>({ max: 3, owner });
		owned.set('a', 1);
		owner.close();
		expect(owned.size).toBe(0);
		expect(owned.set('b', 2)).toBe(false);
		const own = lru<string, number>({ max: 3 });
		own.set('a', 1);
		own[DISPOSE]();
		expect(own.get('a')).toBeUndefined();
		expect(own.set('a', 1)).toBe(false);
	});

	it('a set under an owner that ended already keeps nothing', () => {
		const owner = scope();
		owner.close();
		const c = lru<string, number>({ max: 3, owner });
		expect(c.set('a', 1)).toBe(false);
		expect(c.size).toBe(0);
	});
});
