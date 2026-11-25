// A bench that reaches a runes module of core's dist (a `.svelte.js`), as a package bench that
// imports @ogygia/core does (test: preload.test.ts).
import { bench } from '@bench/heisenbench/bench';
import { LiveValue } from '../../../../packages/core/dist/region-parts/live-value.svelte.js';

bench("a built runes module (core's dist .svelte.js) loads", () => typeof LiveValue);
