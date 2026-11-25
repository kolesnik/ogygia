/**
 * What a region element and its lakes say of a schedule `on_trigger` ran on load instead
 * (contract/trigger.ts `TriggerSaid`).
 *
 * @packageDocumentation
 */
import { TRIGGER_MISSING, type TriggerSaid } from '../contract/trigger.ts';
import { OgygiaError, warn } from '../messages/core.ts';
import { OG_HOLE } from '../wire-markup.ts';

/** `el`'s schedule `value` ran on load (`said`, never `TRIGGER_ARMED`): its arm is left out of the
 *  build (an error: the app scheduled it), or it names no trigger (a warning). */
export function say_trigger(el: Element, value: string, said: TriggerSaid): void {
	const a = {
		region: el.getAttribute('entry') || el.getAttribute(OG_HOLE) || 'ogygia-region',
		value
	};
	if (said === TRIGGER_MISSING) console.error(new OgygiaError('region_schedule_missing', a));
	else warn('region_wake_unknown', a);
}
