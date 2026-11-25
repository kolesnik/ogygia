/**
 * The Kit page thread's makers (./kit-page-thread.svelte.ts), made in a plain module: the build's
 * macros never compile a runes file, and here they check the options at build (internal/macros
 * options pass), so the boot ships no option checks for them.
 *
 * @packageDocumentation
 */
import { say, type Flights, type Stale } from '@ogygia/machine';
import { plainFlights } from '@ogygia/machine';

/** The one shared wait for Kit's page: `run` is the thread's own; an answer is kept for no time. */
export function kit_page_flights(
	run: (_: void, signal: AbortSignal) => Promise<void>
): Flights<void, void | Stale, void> {
	return plainFlights({ name: 'kit page thread', run, keep: 0 }) as Flights<
		void,
		void | Stale,
		void
	>;
}

/** Each Kit file that failed to load, said once. */
export const kit_boot_said: ReturnType<typeof say> = say();
