/**
 * Core's macros: the one config every build that reads core's source runs (tsdown for dist, the
 * Vitest projects, and Heisenbench through its mirror), so each counts and tests what ships.
 */
import { fileURLToPath } from 'node:url';
import { relative } from 'node:path';
import { compile, type CompileResult, type Mode } from 'ogygia-internal-macros/compile';
import { MachineTypes, ogygia_macros, specifier } from 'ogygia-internal-macros/plugin';

const here = (path: string): string => fileURLToPath(new URL(path, import.meta.url));

const ROOT = here('./');

/** Where compiled output imports the macros' runtime from. */
export const MACRO_RUNTIME: string = here('./src/runtime/macros.ts');

/** Core's source: the only files the macros compile. */
export const MACRO_ROOTS: ReadonlyArray<string> = [here('./src/')];

/** Core's types, as its tsconfig reads them: which `$machine` definition each call site moves. */
export const MACRO_TYPES: string = here('./tsconfig.json');

/** Core's macros, as a build plugin (dist keeps the gates: each app's build folds them). One
 *  reading of core's types per plugin (per build). */
export function core_macros(): ReturnType<typeof ogygia_macros> {
	return ogygia_macros({
		mode: 'dev',
		runtime: MACRO_RUNTIME,
		root: ROOT,
		roots: MACRO_ROOTS,
		types: MACRO_TYPES
	});
}

let types: MachineTypes | null = null;

/** One core file compiled as the build compiles it (`mode` `prod` for what an app's production
 *  build runs), for a tool that reads files itself (Heisenbench's mirror); null when it has no
 *  macro. Every call shares one reading of core's types. */
export function core_compile(code: string, file: string, mode: Mode): CompileResult | null {
	return compile(code, relative(ROOT, file), {
		mode,
		runtime: specifier(file, MACRO_RUNTIME),
		reference: specifier(file, MACRO_RUNTIME),
		path: file,
		types: (types ??= new MachineTypes(MACRO_TYPES))
	});
}
