/**
 * The live program's load (./live-program.ts, its own lazy chunk), for a held region's first tick
 * (./core.ts `#apply_live`). Only a build with held regions has this module in its boot
 * (`ogygia:boot/feature-code`), so only it has the chunk.
 *
 * @internal
 * @packageDocumentation
 */
import { plainFlights, type Stale } from '@ogygia/machine';
import { import_again } from './import-again.ts';
import { download } from '../policies.ts';

type LiveProgram = typeof import('./live-program.ts');

/** The live program once a tick has loaded it, else null. */
export let loaded: LiveProgram | null = null;

const import_live = import_again(() => import('./live-program.ts'));

const program = plainFlights({
	name: 'live program',
	run: () => import_live().then((m) => (loaded = m)),
	retry: download
});

/** The live program's one load: shared by every first tick, retried as a download is. */
export function load(): Promise<LiveProgram | Stale> {
	return program.get();
}
