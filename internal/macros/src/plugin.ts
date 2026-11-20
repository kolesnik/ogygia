/**
 * The macros as a Vite / rolldown / tsdown plugin: compiles a file's macros before anything else
 * reads it. Svelte's files are never compiled (compilerkit's plugin refuses them).
 *
 * @packageDocumentation
 */
import { dirname, isAbsolute, relative, sep } from 'node:path';
import { macroPlugin, notSource } from 'ogygia-internal-compilerkit';
import { compile, type CompileResult, type Mode } from './compile.ts';

/** The plugin's options. */
export interface MacroOptions {
	readonly mode?: Mode;
	/** The macros' runtime: a bare specifier, or an absolute file each compiled file imports
	 *  relatively. */
	readonly runtime: string;
	/** The reference implementation (reference mode): a specifier or an absolute file. */
	readonly reference?: string;
	/** Paths in build errors are relative to this folder. */
	readonly root?: string;
	/** Only files under these folders (absolute) are compiled. */
	readonly roots?: ReadonlyArray<string>;
}

/** An absolute target as a `./`-relative import from `file`; a bare specifier stays. */
export function specifier(file: string, target: string): string {
	if (!isAbsolute(target)) return target;
	const rel = relative(dirname(file), target).split(sep).join('/');
	return rel.startsWith('.') ? rel : `./${rel}`;
}

/** ogygia's macros, as a build plugin. */
export function ogygia_macros(
	options: MacroOptions
): ReturnType<typeof macroPlugin<CompileResult>> {
	const mode = options.mode ?? 'dev';
	const root = options.root ?? process.cwd();
	const roots = options.roots?.map((r) => (r.endsWith(sep) ? r : r + sep));
	return macroPlugin<CompileResult>({
		name: 'ogygia-macros',
		skip: (file) =>
			notSource(file) ||
			file === options.runtime ||
			(roots !== undefined && !roots.some((r) => file.startsWith(r))),
		compile: (code, file) =>
			compile(code, relative(root, file), {
				mode,
				runtime: specifier(file, options.runtime),
				path: file,
				reference: specifier(file, options.reference ?? options.runtime)
			})
	});
}
