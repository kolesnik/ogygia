/**
 * Compiling one file's macros: null when nothing in it changes (it uses no macro, imports no marked
 * function, and awaits no STALE-capable call), so the build keeps the file as it is.
 *
 * @packageDocumentation
 */
import { Compiler, type CompileOptions, type CompileResult } from './compiler.ts';
import { reaches_marks } from './marks.ts';

export type { CompileOptions, CompileResult, Mode } from './compiler.ts';
export { MacroError } from 'ogygia-internal-compilerkit';

/** Compiles one file's macros; null when it uses none and imports no marked function. */
export function compile(code: string, file: string, options: CompileOptions): CompileResult | null {
	const reaches = reaches_marks(code, options.path) || awaits_stale(code);
	if (!reaches && !Compiler.may_want(code)) return null;
	const compiler = new Compiler(code, file, options);
	if (compiler.uses.size === 0 && !reaches) return null;
	const out = compiler.run();
	return out.code === code ? null : out;
}

const AWAIT_RE = /\bawait\b/;
const STALE_CALL_RE = /\.(?:task|wait|ask)\(/;

/** Whether `code` may await a wait that settles STALE (so the build checks it is an `$await`). */
function awaits_stale(code: string): boolean {
	return AWAIT_RE.test(code) && STALE_CALL_RE.test(code);
}
