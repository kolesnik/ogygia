/**
 * One file under compile: its text parsed once (a parse error fails the build at its place), the
 * mode it compiles in, and the runtime its output imports.
 *
 * - `dev` and `prod`: the macros expand to calls on the runtime (`$.name`); `prod` may drop what
 *   only development checks.
 * - `reference`: the macros expand to a plain reading of themselves, on a reference
 *   implementation, so a test can run both and compare.
 *
 * @packageDocumentation
 */
import { parseSync } from 'oxc-parser';
import type { N } from './ast.ts';
import type { Report } from './report.ts';

/** How a file compiles. */
export type Mode = 'dev' | 'prod' | 'reference';

/** Where the output imports from, by mode. */
export interface Runtimes {
	readonly mode: Mode;
	/** The runtime `dev` and `prod` output imports. */
	readonly runtime: string;
	/** The reference implementation `reference` output imports. */
	readonly reference: string;
}

/** The module a file's output imports its macros' runtime from. */
export function runtimeOf(options: Runtimes): string {
	return options.mode === 'reference' ? options.reference : options.runtime;
}

/** `code` parsed as a TypeScript module; its first parse error fails the build where it is. */
export function parse(code: string, report: Report): N {
	const parsed = parseSync(report.file, code, {
		lang: 'ts',
		sourceType: 'module'
	});
	if (parsed.errors.length !== 0)
		report.fail(
			{ start: parsed.errors[0]!.labels?.[0]?.start ?? 0 },
			`parse error: ${parsed.errors[0]!.message}`
		);
	return parsed.program;
}
