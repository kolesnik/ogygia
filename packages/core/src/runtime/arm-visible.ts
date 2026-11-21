/**
 * A region's `visible` schedule (the `visible` feature: a region element arms it only in a build
 * whose word holds `F_VISIBLE`, contract/trigger.ts `ScheduleArms`).
 *
 * @packageDocumentation
 */
import type { Run } from '@ogygia/machine';
import { once_on_screen } from './viewport.ts';

/** Runs `fire` once `el` is on screen, within `root_margin` (else its `margin`), while `owner`'s
 *  visit lasts. */
export function on_visible(
	el: Element,
	fire: () => unknown,
	root_margin: string | undefined,
	owner: Run
): void {
	const rootMargin = root_margin || el.getAttribute('margin') || '0px';
	// oxlint-disable-next-line ogygia/no-silent-failures -- a wake; its hydrate says its own failure
	const seen = () => void fire();
	owner.visit().defer(once_on_screen(el, rootMargin, seen));
}
