/**
 * Gating marks, at the definition: `const check: (n: number) => void = $dev(function check(n:
 * number): void { … })` runs in development only, `$rules(…)` in the rules tier (development, and
 * `OGYGIA_RULES=1` builds). The type is written on the const (isolated declarations need it), the
 * function inside keeps its own name. Which functions a module marks is read from its tree, once
 * per text, so a file that imports one knows to put its calls behind the gate.
 *
 * @packageDocumentation
 */
import { parseSync, resolveSpecifier, type N } from 'ogygia-internal-compilerkit';
import { markedDefinition, type MarkedDefinition } from 'ogygia-internal-compilerkit/marks';
import { fileCache, relativeImports } from 'ogygia-internal-compilerkit/modules';

/** Each gating mark, by the gate it puts calls behind. */
export const GATE_MARKS: Readonly<Record<string, string>> = { $dev: 'dev', $rules: 'rules' };

/** Each mark at a definition (the gating marks, and `$hot`/`$layout`, ./hot-pass.ts), by the place
 *  of the function among its arguments. */
export const MARK_PLACES: Readonly<Record<string, number>> = {
	$dev: 0,
	$rules: 0,
	$hot: 0,
	$layout: 0
};

/** A top-level statement's marked definition (exported or not), or null. */
export function marked_definition(statement: N): MarkedDefinition | null {
	const d = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
	return d === null ? null : markedDefinition(d, { type: 'Program' }, MARK_PLACES);
}

/** The functions `program` marks at its top, name → mark. */
export function marks_of(program: N): Map<string, string> {
	const out = new Map<string, string>();
	for (const statement of program.body as Array<N>) {
		const d = marked_definition(statement);
		if (d !== null && d.declarator.id.type === 'Identifier') out.set(d.declarator.id.name, d.mark);
	}
	return out;
}

const MARK_RE = /\$(?:dev|rules|hot|layout)\(/;

/** The functions the module at `file` marks, name → mark; null when it cannot be read. */
export const marked_in: (file: string) => ReadonlyMap<string, string> | null = fileCache(
	(path, source) =>
		MARK_RE.test(source)
			? marks_of(parseSync(path, source, { lang: 'ts', sourceType: 'module' }).program)
			: new Map()
);

const FROM_RE = /\bfrom\s*['"](\.{1,2}\/[^'"]+)['"]/g;

/** Whether `code` imports or re-exports from a relative module that marks a function, so it is
 *  compiled even when it names no macro itself. */
export function reaches_marks(code: string, path: string | undefined): boolean {
	if (path === undefined) return false;
	for (const m of code.matchAll(FROM_RE)) {
		const file = resolveSpecifier(path, m[1]!);
		if (file !== null && (marked_in(file)?.size ?? 0) !== 0) return true;
	}
	return false;
}

/** The marked functions `program` (at `path`) imports by name, local name → mark. */
export function imported_marks(path: string, program: N): Map<string, string> {
	const out = new Map<string, string>();
	for (const [local, { from, name }] of relativeImports(path, program, { values: true })) {
		const mark = marked_in(from)?.get(name);
		if (mark !== undefined) out.set(local, mark);
	}
	return out;
}
