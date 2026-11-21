// A bench file that installs a browser's globals as it loads, as core's hydration benches do, and
// fills a process slot, as core's server hooks do (test: preload.test.ts).
import { bench } from '@bench/heisenbench/bench';

const g = globalThis as unknown as Record<string | symbol, unknown>;
g.window = globalThis;
g.document = { title: 'a page' };
g[Symbol.for('ogygia.bench-world')] ??= { reader: 'installed by world-browser.bench.ts' };

bench('a file that installs a browser runs in it', () => {
	if (typeof g.window === 'undefined') throw new Error('its own window is gone');
	if (g[Symbol.for('ogygia.bench-world')] === undefined) throw new Error('its own slot is gone');
});
