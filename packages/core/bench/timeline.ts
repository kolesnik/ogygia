/**
 * The bench page's resource timeline, on the bench's own loop: what the runtime's download
 * record (runtime/import-again.ts `hear_responses`) observes. Node's `PerformanceObserver` reports
 * on Node's own loop, outside the bench's, so one run's observer reported into a later run's
 * window. The page downloads nothing a timeline holds (its
 * island files are stand-in modules): the stand-in observes, and reports nothing. Import it before
 * core's modules.
 */
import { replace_global } from './world.ts';

class StandInPerformanceObserver {
	static readonly supportedEntryTypes: readonly string[] = ['resource'];
	observe(): void {}
	disconnect(): void {}
	takeRecords(): PerformanceEntry[] {
		return [];
	}
}

replace_global('PerformanceObserver', StandInPerformanceObserver);
