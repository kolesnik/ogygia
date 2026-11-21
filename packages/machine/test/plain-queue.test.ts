/**
 * plain_queue(): the server's bounded first-come-first-served line, as queue({ max }) makes it,
 * with none of the passes' options (it refuses them, and a missing max).
 */
import { describe, expect, test } from 'vitest';
import { queue, scope, type Place, type Queue, type QueueOptions } from '../src/index.ts';
import { plainQueue, trustedPlainQueue } from '../src/index.ts';

type Made = (o: QueueOptions<number>) => Queue<number>;

/** A seeded walk of pushes, cancels, releases and an owner close, told as text. */
function walk(make: Made, seed: number): string {
	let s = seed;
	const next = () => (s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
	const said: string[] = [];
	const held: Place[] = [];
	let clock = 0;
	const owner = scope();
	const q = make({
		name: 'walk',
		max: 1 + Math.floor(next() * 3),
		now: () => clock,
		owner,
		start: (job, place) => {
			said.push(`start ${job}`);
			held.push(place);
		},
		stale: (job) => void said.push(`stale ${job}`)
	});
	for (let i = 0; i < 40; i++) {
		const r = next();
		if (r < 0.45) q.push(i, next() < 0.3 ? clock + Math.floor(next() * 5) : undefined);
		else if (r < 0.6) q.cancel(Math.floor(next() * i));
		else if (r < 0.85) held.splice(Math.floor(next() * held.length), 1)[0]?.release();
		else clock += 1;
		said.push(`${q.waiting}/${q.holding}`);
	}
	owner.close();
	q.push(99);
	said.push(`${q.waiting}/${q.holding}`);
	return said.join(' ');
}

describe('plain_queue', () => {
	test('it walks as queue({ max }) walks: every start, stale, wait and hold the same', () => {
		for (let seed = 1; seed <= 200; seed++) {
			const want = walk((o) => queue(o), seed);
			expect(walk(plainQueue, seed)).toBe(want);
			expect(walk(trustedPlainQueue, seed)).toBe(want);
		}
	});

	test('it refuses what only passes take, and a missing max', () => {
		const start = () => {};
		expect(() => plainQueue({ start })).toThrow(/machine_bad_option|max/);
		expect(() => plainQueue({ max: 2, start, priority: () => 0 })).toThrow(/plain_queue/);
		expect(() => plainQueue({ max: 2, start, ready: () => true })).toThrow(/plain_queue/);
		expect(() => plainQueue({ max: 2, start, budget: { ms: 1, yield: () => {} } })).toThrow(
			/plain_queue/
		);
		expect(() => plainQueue({ max: 0, start })).toThrow();
	});
});
