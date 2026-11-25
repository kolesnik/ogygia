/**
 * Other modules, as a macro that reads across files sees them: a source file by its import path
 * (with or without `.ts`), a reading of it made once and again only when its text changes, and the
 * names it imports from relative modules.
 *
 * @packageDocumentation
 */
import { existsSync, readFileSync } from 'node:fs';
import { resolveSpecifier } from './specifier.ts';
import { keyName, type N } from './ast.ts';

/** A name a module imports from a relative module: that module's file and the name it exports. */
export interface Import {
	readonly from: string;
	readonly name: string;
}

/** The source file an import path names: the path itself, else with `.ts`; null when neither
 *  exists. */
export function sourceOf(file: string): string | null {
	if (existsSync(file)) return file;
	const ts = `${file}.ts`;
	return existsSync(ts) ? ts : null;
}

/**
 * A reading of source files, cached by path: `make` runs on a file's text once, and again only
 * when the text changed. The returned function takes an import path (see `sourceOf`) and gives
 * null when no file is there.
 */
export function fileCache<T>(make: (path: string, code: string) => T): (file: string) => T | null {
	// oxlint-disable-next-line dnd/owned-collections -- the build's own cache: one entry per source file, replaced when the file changes
	const read = new Map<string, { code: string; made: T }>();
	return (file) => {
		const path = sourceOf(file);
		if (path === null) return null;
		const code = readFileSync(path, 'utf8');
		const had = read.get(path);
		if (had !== undefined && had.code === code) return had.made;
		const made = make(path, code);
		read.set(path, { code, made });
		return made;
	};
}

/**
 * The names `program` (the module at `file`) imports from relative modules, by local name. With
 * `values`, a type-only import (`import type`, or a `type` specifier) is left out.
 */
export function relativeImports(
	file: string,
	program: N,
	options: { readonly values?: boolean } = {}
): Map<string, Import> {
	const out = new Map<string, Import>();
	for (const node of program.body as Array<N>) {
		if (node.type !== 'ImportDeclaration') continue;
		if (options.values === true && node.importKind === 'type') continue;
		const source = String(node.source.value);
		const target = resolveSpecifier(file, source);
		if (target === null) continue;
		for (const spec of node.specifiers)
			if (
				spec.type === 'ImportSpecifier' &&
				(options.values !== true || spec.importKind !== 'type')
			)
				out.set(spec.local.name, {
					from: target,
					name: keyName({ key: spec.imported })
				});
	}
	return out;
}
