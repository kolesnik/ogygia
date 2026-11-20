import { expect, test } from 'vitest';
import * as rt from '../src/run.ts';
import { STAGE_COMPILED } from '../src/stage.ts';

test('the stage machine a production build carries is define’s reading of its steps', () => {
	const read = rt.define({
		name: 'stage',
		initial: 'building',
		steps: {
			building: ['built', 'discarded'],
			built: ['committing', 'discarded'],
			committing: ['committed', 'discarded'],
			committed: [],
			discarded: []
		}
	});
	const made = rt.compiled(...STAGE_COMPILED);
	expect([made.name, [...made.names], made.initial, [...made.masks]]).toEqual([
		read.name,
		[...read.names],
		read.initial,
		[...read.masks]
	]);
});
