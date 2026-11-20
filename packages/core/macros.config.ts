/**
 * Core's macros: the one config every build that reads core's source runs (tsdown for dist, the
 * Vitest projects, and Heisenbench through its mirror), so each counts and tests what ships.
 */
import { fileURLToPath } from 'node:url';
import { ogygia_macros } from 'ogygia-internal-macros/plugin';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

/** Where compiled output imports the macros' runtime from. */
export const MACRO_RUNTIME: string = here('./src/runtime/macros.ts');

/** Core's source: the only files the macros compile. */
export const MACRO_ROOTS: ReadonlyArray<string> = [here('./src/')];

/** Core's macros, as a build plugin (dist keeps the gates: each app's build folds them). */
export function core_macros(): ReturnType<typeof ogygia_macros> {
	return ogygia_macros({
		mode: 'dev',
		runtime: MACRO_RUNTIME,
		root: here('./'),
		roots: MACRO_ROOTS
	});
}
