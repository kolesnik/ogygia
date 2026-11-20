// The build's feature word (src/link/runtime-entry.ts): every feature's detect read over an app's
// marks, once per build for the browser's runtime entry and once for the server's word. A large
// app's marks: many islands woken on load, on idle, on screen and on media queries, holes fetched
// and prefetched on their own schedules, lakes revalidated; and a lean app with no schedule but
// load, whose detects all answer no.
import { bench } from '@bench/heisenbench/bench';
import {
	generateServerFlagsSource,
	resolveFeatures,
	type RuntimeMarks
} from '../src/link/runtime-entry.ts';

const WAKES = ['load', 'idle', 'visible', 'none', '(min-width: 48em)', 'interaction'];

function marks_of(islands: number): RuntimeMarks {
	return {
		complete: true,
		forms: true,
		wire: true,
		remoteSeeds: true,
		router: true,
		live: false,
		lakes: true,
		page: true,
		context: true,
		hydrate: Array.from({ length: islands }, (_, i) => WAKES[i % WAKES.length]),
		defer: Array.from({ length: islands >> 2 }, (_, i) => (i % 2 ? 'visible' : 'load')),
		prefetch: Array.from({ length: islands >> 3 }, () => 'idle'),
		revalidate: Array.from({ length: islands >> 3 }, () => '(prefers-color-scheme: dark)'),
		persistKeys: []
	};
}

function lean_of(islands: number): RuntimeMarks {
	return {
		complete: true,
		forms: false,
		wire: false,
		remoteSeeds: false,
		router: false,
		live: false,
		lakes: false,
		page: false,
		hydrate: Array.from({ length: islands }, () => 'load'),
		defer: [],
		prefetch: [],
		revalidate: [],
		persistKeys: []
	};
}

bench(
	"resolveFeatures: a large app's marks, every schedule kind",
	({ marks }) => resolveFeatures(marks).length,
	{ setup: () => ({ marks: marks_of(120) }), scale: (_ctx, k) => ({ marks: marks_of(120 * k) }) }
);

bench(
	'resolveFeatures: a lean app, every island woken on load',
	({ marks }) => resolveFeatures(marks).length,
	{ setup: () => ({ marks: lean_of(120) }), scale: (_ctx, k) => ({ marks: lean_of(120 * k) }) }
);

bench(
	"generateServerFlagsSource: the server's word for a large app",
	({ marks }) => generateServerFlagsSource(marks).length,
	{ setup: () => ({ marks: marks_of(120) }), scale: (_ctx, k) => ({ marks: marks_of(120 * k) }) }
);
