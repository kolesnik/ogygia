/**
 * Compiling one file's macros: null when it uses none, so the build keeps the file as it is.
 *
 * @packageDocumentation
 */
import { Compiler, type CompileOptions, type CompileResult } from './compiler.ts';

export type { CompileOptions, CompileResult, Mode } from './compiler.ts';
export { MacroError } from 'ogygia-internal-compilerkit';

/** Compiles one file's macros; null when it uses none. */
export function compile(code: string, file: string, options: CompileOptions): CompileResult | null {
	if (!Compiler.may_want(code)) return null;
	const compiler = new Compiler(code, file, options);
	if (compiler.uses.size === 0) return null;
	return compiler.run();
}
