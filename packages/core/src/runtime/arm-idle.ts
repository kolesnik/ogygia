/**
 * A region's `idle` schedule (the `idle` feature: a region element arms it only in a build whose
 * word holds `F_IDLE`, contract/trigger.ts `ScheduleArms`).
 *
 * @packageDocumentation
 */
import type { Run } from '@ogygia/machine/internal';

/** Runs `fire` at the browser's next idle moment, or 2 s at most (a short pause where the browser
 *  has no idle callback), while `owner`'s visit lasts. */
export function on_idle(fire: () => unknown, owner: Run): void {
	const s = owner.visit();
	// @why WebKit has no requestIdleCallback (test: test/browser/hole-when.test.ts › an idle hole in a browser with no idle callback fetches after a short pause, not at once)
	if (!('requestIdleCallback' in window)) {
		s.later(() => fire(), 200);
		return;
	}
	const once = s.child();
	const first = () => {
		once.close();
		fire();
	};
	once.later(first, 'idle');
	once.later(first, 2000);
}
