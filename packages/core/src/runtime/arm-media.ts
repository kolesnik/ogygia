/**
 * A region's media query schedule (the `media` feature: a region element arms it only in a build
 * whose word holds `F_MEDIA`, contract/trigger.ts `ScheduleArms`).
 *
 * @packageDocumentation
 */
import type { Run } from '@ogygia/machine';
import { is_media_query } from '../contract/trigger.ts';

/** When `q` is a media query: runs `fire` now when it matches, else the first time it comes to
 *  match, while `owner`'s visit lasts, and returns true. Anything else arms nothing: false. */
export function on_media(q: string, fire: () => unknown, owner: Run): boolean {
	if (!is_media_query(q)) return false;
	const mql = matchMedia(q);
	if (mql.matches) {
		// oxlint-disable-next-line ogygia/no-silent-failures -- a wake; its hydrate says its own failure
		void fire();
		return true;
	}
	const once = owner.visit().child();
	once.listen(mql, 'change', (e) => {
		if (!e.matches) return;
		once.close();
		fire();
	});
	return true;
}
