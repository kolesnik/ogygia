import { describe, expect, it } from 'vitest';
import { flights, MachineError, STALE, world } from '../src/index.ts';
import { plainFlights } from '../src/index.ts';
import { DISPOSE } from './_dispose.ts';

/** A run that answers when told, counting its runs. */
function held() {
	const runs: Array<{ input: unknown; answer: (v: unknown) => void }> = [];
	const run = (input: unknown) => new Promise((answer) => runs.push({ input, answer }));
	return { runs, run };
}

describe('plainFlights: flights() with no world, weigh, touches or key of two fields', () => {
	for (const [label, make] of [
		['plainFlights', plainFlights],
		['flights', flights as unknown as typeof plainFlights]
	] as const)
		it(`${label}: one key's callers share a run, keep its answer, and a drop ends it`, async () => {
			const { runs, run } = held();
			const f = make<string, unknown>({ name: 't', run, keep: Infinity });
			const a = f.get('x');
			const b = f.get('x');
			expect(runs).toHaveLength(1);
			runs[0]!.answer(1);
			expect(await a).toBe(1);
			expect(await b).toBe(1);
			expect(f.peek('x')).toMatchObject({ kind: 'kept', answer: 1 });
			const c = f.get('y');
			f.drop('y');
			expect(await c).toBe(STALE);
			f[DISPOSE]();
			expect(await f.get('x')).toBe(STALE);
		});

	for (const [label, make] of [
		['plainFlights', plainFlights],
		['flights', flights as unknown as typeof plainFlights]
	] as const)
		it(`${label}: keyed by one field, or by none, as flights() keys them`, async () => {
			const { runs, run } = held();
			const one = make.keyed<{ a: string; b?: number }>()({
				key: ['a'],
				ignore: { b: 'how, not what' },
				run,
				keep: Infinity
			});
			void one.get({ a: 'x', b: 1 });
			void one.get({ a: 'x', b: 2 });
			void one.get({ a: 'y' });
			expect(runs.map((r) => r.input)).toEqual([{ a: 'x', b: 1 }, { a: 'y' }]);
			const named: unknown[] = [];
			one.drop((key) => (named.push(key), false));
			expect(named).toEqual([{ a: 'x' }, { a: 'y' }]);
			const none = make.keyed<{ a: string }>()({ key: [], ignore: { a: 'one for all' }, run });
			void none.get({ a: 'x' });
			void none.get({ a: 'y' });
			expect(runs).toHaveLength(3);
		});

	it('refuses, in dev and rules builds, what only flights() takes', () => {
		const run = () => 1;
		for (const options of [
			{ run, world: world() },
			{ run, weigh: () => 1, max: 10 },
			{ run, touches: () => [] }
		])
			expect(() => plainFlights(options as never)).toThrow(MachineError);
		expect(() =>
			plainFlights.keyed<{ a: string; b: string }>()({ key: ['a', 'b'] as never, run })
		).toThrow(MachineError);
	});

	it('takes none of them in its types', () => {
		const run = () => 1;
		// @ts-expect-error -- a world is flights()'s
		void (() => plainFlights({ run, world: world() }));
		// @ts-expect-error -- a weigh is flights()'s
		void (() => plainFlights({ run, weigh: () => 1, max: 10 }));
		// @ts-expect-error -- a key of two fields is flights()'s
		void (() => plainFlights.keyed<{ a: string; b: string }>()({ key: ['a', 'b'], run }));
		expect(true).toBe(true);
	});
});
