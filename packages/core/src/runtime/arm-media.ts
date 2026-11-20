/**
 * A region's media query schedule (the `media` feature: a region element arms it only in a build
 * whose word holds `F_MEDIA`, contract/trigger.ts `ScheduleArms`).
 *
 * @packageDocumentation
 */
import type { Run } from '@ogygia/machine/internal';

/** Runs `fire` now when `q` matches, else the first time it comes to match, while `owner`'s visit
 *  lasts. */
export function on_media(q: string, fire: () => unknown, owner: Run): void {
	const mql = matchMedia(q);
	// oxlint-disable-next-line ogygia/no-silent-failures -- a wake; its hydrate says its own failure
	if (mql.matches) return void fire();
	const once = owner.visit().child();
	once.listen(mql, 'change', (e) => {
		if (!e.matches) return;
		once.close();
		fire();
	});
}
