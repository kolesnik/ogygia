/**
 * Compiling one file's macros: null when it uses none and imports no marked function, so the build
 * keeps the file as it is.
 *
 * @packageDocumentation
 */
import { Compiler, type CompileOptions, type CompileResult } from './compiler.ts';
import { reaches_marks } from './marks.ts';

export type { CompileOptions, CompileResult, Mode } from './compiler.ts';
export { MacroError } from 'ogygia-internal-compilerkit';

/** Compiles one file's macros; null when it uses none and imports no marked function. */
export function compile(code: string, file: string, options: CompileOptions): CompileResult | null {
	const reaches = reaches_marks(code, options.path);
	if (!reaches && !Compiler.may_want(code)) return null;
	const compiler = new Compiler(code, file, options);
	if (compiler.uses.size === 0 && !reaches) return null;
	return compiler.run();
}
