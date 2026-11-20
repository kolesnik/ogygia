// RUNTIME FLAGS (`ogygia:boot/runtime-flags`): build-time constants for code that lives inside the
// always-on region element. `HAS`, the feature word, holds a feature's bit exactly when the marks
// select it: the element's fetch / apply / morph path is only ever reached through the frame store,
// so a build without the store must not ship that path, and a build with it must keep it.
import { describe, expect, it } from 'vitest';
import { FEATURE_BITS, F_FRAMES, type FeatureName } from '@ogygia/core/contract';
import {
	FEATURE_ORDER,
	generateRuntimeFlagsSource,
	generateServerFlagsSource,
	resolveFeatures,
	type RuntimeMarks
} from '../src/link/runtime-entry.ts';

const RUNTIME_DIR = '/app/node_modules/@ogygia/core/dist/runtime';

const word = (marks: RuntimeMarks, all = false) =>
	Number(/HAS = (\d+);/.exec(generateRuntimeFlagsSource(marks, RUNTIME_DIR, all))![1]);
const flag = (marks: RuntimeMarks, all = false) => (word(marks, all) & F_FRAMES) !== 0;

describe('runtime flags', () => {
	it('the word holds a bit for each selected feature, and only those', () => {
		const cases: RuntimeMarks[] = [
			{ complete: true, hydrate: ['load'] },
			{ complete: true, hydrate: ['interaction'], forms: true, router: true },
			{ complete: true, live: true, wire: true, context: true },
			{ complete: true, foreign: true },
			{}
		];
		for (const marks of cases) {
			const selected = new Set(resolveFeatures(marks));
			for (const id of FEATURE_ORDER)
				expect((word(marks) & FEATURE_BITS[id]) !== 0, `${id} ${JSON.stringify(marks)}`).toBe(
					selected.has(id)
				);
		}
	});

	it('every feature has a bit of its own', () => {
		const bits = FEATURE_ORDER.map((id: FeatureName) => FEATURE_BITS[id]);
		expect(new Set(bits).size).toBe(FEATURE_ORDER.length);
		for (const bit of bits) expect(bit & (bit - 1)).toBe(0);
	});

	it('the frames bit is the frames feature: on wherever a region streams HTML', () => {
		const cases: RuntimeMarks[] = [
			{ complete: true, hydrate: ['load'] },
			{ complete: true, hydrate: ['load'], defer: ['load'] },
			{ complete: true, live: true },
			{ complete: true, morph: true },
			{ complete: true, lakes: true },
			{ complete: true, hydrate: ['none'] },
			{ complete: true, router: true }
		];
		for (const marks of cases)
			expect(flag(marks), JSON.stringify(marks)).toBe(resolveFeatures(marks).includes('frames'));
		expect(flag({ complete: true, hydrate: ['load'] })).toBe(false);
		expect(flag({ complete: true, defer: ['visible'] })).toBe(true);
	});

	it('the codec is imported on use only where the wire feature is out of the build', () => {
		const on_use = (marks: RuntimeMarks, all = false) =>
			/load_wire_codec = (.*);/.exec(generateRuntimeFlagsSource(marks, RUNTIME_DIR, all))![1];
		expect(on_use({ complete: true, hydrate: ['load'] })).toBe(
			`() => import("${RUNTIME_DIR}/../live-transport.js")`
		);
		// a build with the codec has no import() of it in the boot's graph: that edge alone would
		// split the boot's shared chunk (apps/palaestra/e2e/lazy-chunks.spec.ts)
		expect(on_use({ complete: true, hydrate: ['load'], wire: true })).toBe('null');
		expect(on_use({})).toBe('null');
		expect(on_use({ complete: true, hydrate: ['load'] }, true)).toBe('null');
	});

	it('incomplete marks and dev keep every flag on', () => {
		expect(flag({})).toBe(true);
		expect(flag({ complete: true, hydrate: ['load'] }, true)).toBe(true);
	});

	it("the server's word is the browser's, for the same marks", () => {
		const server_word = (marks: RuntimeMarks, all = false) =>
			Number(/^export const HAS = (\d+);\n$/.exec(generateServerFlagsSource(marks, all))![1]);
		const cases: RuntimeMarks[] = [
			{ complete: true, hydrate: ['load'] },
			{ complete: true, hydrate: ['load'], defer: ['idle'] },
			{ complete: true, lakes: true },
			{ complete: true, live: true, wire: true, context: true },
			{ complete: true, foreign: true },
			{}
		];
		for (const marks of cases)
			for (const all of [false, true])
				expect(server_word(marks, all), JSON.stringify(marks)).toBe(word(marks, all));
		expect(server_word({ complete: true, hydrate: ['load'] }) & F_FRAMES).toBe(0);
	});
});
