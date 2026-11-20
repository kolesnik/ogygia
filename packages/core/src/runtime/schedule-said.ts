/**
 * What a region element and its lakes say of a schedule `on_trigger` ran on load instead
 * (contract/trigger.ts `TriggerSaid`).
 *
 * @packageDocumentation
 */
import { OgygiaError } from '../messages/core.ts';
import { OG_HOLE } from '../wire-markup.ts';

/** The name a message gives `el`: its entry, else its hole id. */
export function region_label(el: Element): string {
	return el.getAttribute('entry') || el.getAttribute(OG_HOLE) || 'ogygia-region';
}

/** `el`'s schedule `value` needs an arm its build left out: it ran on load. */
export function say_schedule_missing(el: Element, value: string): void {
	console.error(new OgygiaError('region_schedule_missing', { region: region_label(el), value }));
}
