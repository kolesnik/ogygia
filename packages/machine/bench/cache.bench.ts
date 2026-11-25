// A cache's hot paths, as the runtime and the server use them: sets that fill it and push the least
// recently used out, gets that find (and touch) what it holds, and the eviction notices.
import { bench } from '@bench/heisenbench/bench';
import { cache, type Cache } from '../src/index.ts';
import { lru, rootLife, trustedLru, type Lru } from '../src/index.ts';

const keys = (n: number): string[] => Array.from({ length: n }, (_, i) => `/page/${i}`);

function filled(n: number, max: number): { c: Cache<string, number>; keys: string[] } {
	const c = cache<string, number>({ max });
	const ks = keys(n);
	for (let i = 0; i < ks.length; i++) c.set(ks[i]!, i);
	return { c, keys: ks };
}

bench(
	'cache: set into a full cache (each set lets the least recently used go)',
	({ c, keys }) => {
		let kept = 0;
		for (const k of keys) if (c.set(`${k}?again`, 1)) kept++;
		return kept;
	},
	{
		setup: () => filled(200, 200),
		scale: (_ctx, k) => filled(200 * k, 200 * k)
	}
);

bench(
	'cache: get of every key it holds (each a use)',
	({ c, keys }) => {
		let found = 0;
		for (const k of keys) if (c.get(k) !== undefined) found++;
		return found;
	},
	{
		setup: () => filled(200, 200),
		scale: (_ctx, k) => filled(200 * k, 200 * k)
	}
);

bench(
	'cache: evict with a notice per value (a clear)',
	({ c }) => {
		let heard = 0;
		const noticed = cache<string, number>({
			max: c.size + 1,
			onEvict: () => void heard++
		});
		for (const [k, v] of c.entries()) noticed.set(k, v);
		noticed.clear();
		return heard;
	},
	{
		setup: () => filled(200, 200),
		scale: (_ctx, k) => filled(200 * k, 200 * k)
	}
);

function lru_filled(n: number, max: number): { c: Lru<string, number>; keys: string[] } {
	const c = lru<string, number>({ max });
	const ks = keys(n);
	for (let i = 0; i < ks.length; i++) c.set(ks[i]!, i);
	return { c, keys: ks };
}

bench(
	'lru: set into a full cache (each set lets the least recently used go)',
	({ c, keys }) => {
		let kept = 0;
		for (const k of keys) if (c.set(`${k}?again`, 1)) kept++;
		return kept;
	},
	{
		setup: () => lru_filled(200, 200),
		scale: (_ctx, k) => lru_filled(200 * k, 200 * k)
	}
);

bench(
	'lru: get of every key it holds (each a use)',
	({ c, keys }) => {
		let found = 0;
		for (const k of keys) if (c.get(k) !== undefined) found++;
		return found;
	},
	{
		setup: () => lru_filled(200, 200),
		scale: (_ctx, k) => lru_filled(200 * k, 200 * k)
	}
);

bench(
	"lru: the runtime's caches made in a scope (checked and trusted), used, cleared, let go with it",
	({ n }) => {
		const owner = rootLife();
		let found = 0;
		for (let i = 0; i < n; i++) {
			const c =
				i % 2 === 0
					? trustedLru<string, number>({ max: 4, owner })
					: lru<string, number>({ max: 4, owner });
			for (let k = 0; k < 6; k++) c.set(`/p/${k}`, k);
			if (c.peek('/p/3') !== undefined) found++;
			if (c.delete('/p/5')) found++; // the newest
			if (c.delete('/p/2')) found++;
			found += c.entries().length;
			if (i % 3 === 0) c.clear();
			if (i % 5 === 0) c[Symbol.dispose]();
		}
		owner.close();
		return found;
	},
	{ setup: () => ({ n: 200 }), scale: (_ctx, k) => ({ n: 200 * k }) }
);

bench(
	'cache: values aged out by its one timer (a sweep, the next timer set)',
	async ({ n }) => {
		const c = cache<string, number>({ max: n * 2, keep: 1 });
		for (let i = 0; i < n; i++) c.set(`/a/${i}`, i);
		await new Promise((r) => setTimeout(r, 5));
		const left = c.size;
		c[Symbol.dispose]();
		return left;
	},
	{ setup: () => ({ n: 200 }), scale: (_ctx, k) => ({ n: 200 * k }) }
);
