/**
 * Island warms: an island module's `import()` started before its region needs it (a gesture's
 * pointerenter, a prefetch, a router read of a fetched page), deduped by resolved URL. A boot
 * module: it reads the build's word (`ogygia:boot`), so no package entry may reach it.
 *
 * @packageDocumentation
 */
import { HAS } from 'ogygia:boot';
import { STALE, type Flights } from '@ogygia/machine';
import { plainFlights } from '@ogygia/machine';
import { F_GRAPH } from '../contract/features.ts';
import { LoadSlot } from './load-scheduler.ts';
import { class_at, fetch_priority_of, PRIORITY, type LoadClass } from './load-class.ts';
import { entry_location } from './entry-locations.ts';
import { import_file } from './import-again.ts';
import { code_url, type CodeUrl } from './code-origins.ts';
import { island_module_url } from './region-endpoint-url.ts';
import { preload_island_graph } from './island-graph-preload.ts';

type Warm = { key: string; entry: string; base: string | undefined; url: CodeUrl };
let warm_flights: Flights<Warm, unknown, Pick<Warm, 'key'>> | undefined;
const warms = () => (warm_flights ??= make_warms());
const make_warms = () =>
	plainFlights.keyed<Warm>()({
		name: 'island warm',
		key: ['key'],
		ignore: {
			entry: 'the module the key names, as the warm that started it spelled it',
			base: 'what that spelling resolves against',
			url: 'the key before it was made absolute'
		},
		run: async ({ entry, base, url }, _signal, flight) => {
			const slot = new LoadSlot({
				kind: 'code',
				cls: class_at(flight.priority),
				label: entry,
				flight
			});
			const release = await slot.ready;
			try {
				if (HAS & F_GRAPH) {
					preload_island_graph(entry, base, fetch_priority_of(slot.cls()));
					flight.onRaise((p) => preload_island_graph(entry, base, fetch_priority_of(class_at(p))));
				}
				return await import_file(url);
				// oxlint-disable-next-line ogygia/no-silent-failures -- a warm that failed is not kept (STALE); the island's own load asks again and says its failure
			} catch {
				return STALE;
			} finally {
				release();
			}
		}
	});

/** Test seam: forget every warm (a fresh document). */
export function reset_island_warms(): void {
	warm_flights?.drop(() => true);
	warm_flights = undefined;
}

function warm_key(url: string): string {
	try {
		return new URL(url, location.href).href;
		// oxlint-disable-next-line ogygia/no-silent-failures -- not a URL: its own key
	} catch {
		return url;
	}
}

/** Fire-and-forget `import()` of an island's module, deduped by resolved URL. */
export function warm_island_module(
	entry: string,
	base?: string,
	cls: LoadClass = 'speculative'
): void {
	const url = island_module_url(entry, base);
	if (!url) return;
	if (!entry_location(entry, base) && url.includes('/ogygia/og-region.')) return;
	const code = code_url(url);
	if (code === null) return;
	// oxlint-disable-next-line ogygia/no-silent-failures -- a warm that failed answers STALE, never rejects: nothing to hear
	void warms().get({ key: warm_key(url), entry, base, url: code }, { priority: PRIORITY[cls] });
}

/** Has this island module already been warmed (or imported through the warmer)? `entry` resolves
 *  the way `warm_island_module` resolves it; `base` for an href read off a foreign document. */
export function is_warmed_module(entry: string, base?: string): boolean {
	const url = island_module_url(entry, base);
	return !!url && warm_flights?.peek({ key: warm_key(url) }) !== undefined;
}
