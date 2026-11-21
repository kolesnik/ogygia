// A server bench file loaded after one that installs a browser (test: preload.test.ts).
import { bench } from '@bench/heisenbench/bench';

const g = globalThis as unknown as Record<string | symbol, unknown>;
const seen = () => [typeof g.window, typeof g.document, typeof g[Symbol.for('ogygia.bench-world')]];
const at_load = seen();

bench("a later file loads in Node's own world", () => {
	const now = seen();
	if ([...at_load, ...now].some((t) => t !== 'undefined'))
		throw new Error(
			`an earlier bench file's globals leaked: at load ${at_load.join()}, in the case ${now.join()}`
		);
});
