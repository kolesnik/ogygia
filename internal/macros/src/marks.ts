/**
 * Gating marks: a function whose first statement is `$dev()` runs in development only, one whose
 * first statement is `$rules()` in the rules tier (development, and `OGYGIA_RULES=1` builds). The
 * mark sits in the function it marks, so its declaration stays a plain `function` TypeScript reads
 * (isolated declarations included). Which functions a module marks is read from its tree, once per
 * text, so a file that imports one knows to put its calls behind the gate.
 *
 * @packageDocumentation
 */
import { parseSync, resolveSpecifier, type N } from 'ogygia-internal-compilerkit';
import { fileCache, relativeImports } from 'ogygia-internal-compilerkit/modules';

/** Each gating mark, by the gate it puts calls behind. */
export const GATE_MARKS: Readonly<Record<string, string>> = { $dev: 'dev', $rules: 'rules' };

/** The gating mark a statement is (`$dev();` or `$rules();`), or null. */
export function mark_statement(statement: N): string | null {
	if (statement?.type !== 'ExpressionStatement') return null;
	const call = statement.expression;
	if (call.type !== 'CallExpression' || call.callee.type !== 'Identifier') return null;
	return Object.hasOwn(GATE_MARKS, call.callee.name) ? call.callee.name : null;
}

/** A top-level function declaration of `program` (exported or not), or null. */
export function top_function(statement: N): N {
	const d = statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement;
	return d?.type === 'FunctionDeclaration' ? d : null;
}

/** The functions `program` marks at its top, name → mark. */
export function marks_of(program: N): Map<string, string> {
	const out = new Map<string, string>();
	for (const statement of program.body as Array<N>) {
		const fn = top_function(statement);
		const mark = fn === null ? null : mark_statement(fn.body?.body?.[0]);
		if (mark !== null && fn.id !== null) out.set(fn.id.name, mark);
	}
	return out;
}

const MARK_RE = /\$(?:dev|rules)\(\)/;

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
