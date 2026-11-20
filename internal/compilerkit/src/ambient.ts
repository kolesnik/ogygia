/**
 * The ambient types of a compiler's macros, generated. A consumer keeps one plain module of
 * signatures (`export declare function $twice(value: number): number`, docs included), which
 * `tsc` checks like any module, and hands the kit its macros as values. The kit asks TypeScript
 * for that module's declarations (its own declaration emit, in memory), then writes them as one
 * ambient `.d.ts`: every `$` export a global inside `declare global`, every other type (exported
 * so it carries its docs, or not) beside them at module level, under a "generated, do not edit"
 * header.
 *
 * The macros and the signatures agree: each macro's names are exported, and each export is a
 * macro's; a mismatch is an error naming it.
 *
 * @packageDocumentation
 */
import { dirname, relative, sep } from 'node:path';
import { resolveSpecifier } from './specifier.ts';
import { parseSync } from 'oxc-parser';
import ts from 'typescript';
import type { N } from './ast.ts';
import { declarations } from './types.ts';

/** What the ambient types are made from. */
export interface AmbientOptions {
	/** The signatures module: an absolute path. */
	readonly signatures: string;
	/** The macros, as values: each names the globals it owns. */
	readonly macros: ReadonlyArray<{ readonly names: ReadonlyArray<string> }>;
	/** The generated file's leading comment, line by line (without `// `). */
	readonly header: ReadonlyArray<string>;
	/** Where the ambient file goes (an absolute path): the signatures' relative imports are
	 *  rewritten from there. Without it, a signatures module may not import. */
	readonly output?: string;
	/** Other files the signatures need in the program (ambient declarations they use). */
	readonly include?: ReadonlyArray<string>;
	/** Options for TypeScript's declaration emit, over the kit's own. */
	readonly compilerOptions?: ts.CompilerOptions;
}

/** TypeScript's declarations of one module, in memory. */
export function emitDeclarations(
	file: string,
	options: ts.CompilerOptions = {},
	include: ReadonlyArray<string> = []
): string {
	const program = ts.createProgram([file, ...include], {
		target: ts.ScriptTarget.ES2022,
		module: ts.ModuleKind.ESNext,
		moduleResolution: ts.ModuleResolutionKind.Bundler,
		allowImportingTsExtensions: true,
		strict: true,
		skipLibCheck: true,
		declaration: true,
		emitDeclarationOnly: true,
		removeComments: false,
		noEmit: false,
		types: [],
		...options
	});
	const source = program.getSourceFile(file);
	if (source === undefined) throw new Error(`ambient: no module at ${file}.`);
	const problems = ts.getPreEmitDiagnostics(program, source);
	if (problems.length !== 0)
		throw new Error(
			`ambient: ${file} does not type-check: ${ts.flattenDiagnosticMessageText(problems[0]!.messageText, '\n')}`
		);
	let out: string | null = null;
	program.emit(
		source,
		(_name, text) => {
			out = text;
		},
		undefined,
		true
	);
	if (out === null) throw new Error(`ambient: no declarations for ${file}.`);
	return out;
}

/** An import of the signatures module, its relative path rewritten from `output`. */
function rebased(code: string, n: N, from: string, output: string): string {
	const spec = String(n.source.value);
	const target = resolveSpecifier(from, spec);
	if (target === null) return code.slice(n.start, n.end);
	let to = relative(dirname(output), target).split(sep).join('/');
	if (!to.startsWith('.')) to = `./${to}`;
	return `${code.slice(n.start, n.source.start)}'${to}'${code.slice(n.source.end, n.end)}`;
}

const nameOf = (n: N): string =>
	n.type === 'VariableDeclaration' ? n.declarations[0].id.name : n.id.name;

/** The ambient `.d.ts` of `options.macros`, from their signatures module. */
export function ambientTypes(options: AmbientOptions): string {
	const code = emitDeclarations(options.signatures, options.compilerOptions, options.include);
	const { program, comments } = parseSync('signatures.d.ts', code, {
		lang: 'dts',
		sourceType: 'module'
	});
	const lead = (start: number, floor: number): number => {
		let at = start;
		for (let i = comments.length - 1; i >= 0; i--) {
			const c = comments[i]!;
			if (
				c.end <= at &&
				c.start >= floor &&
				/^\s*$/.test(code.slice(c.end, at)) &&
				!c.value.includes('@packageDocumentation')
			)
				at = c.start;
		}
		return at;
	};
	const helpers: Array<string> = [];
	const globals: Array<string> = [];
	const exported = new Set<string>();
	let floor = 0;
	for (const n of program.body as Array<N>) {
		const start = lead(n.start, floor);
		floor = n.end;
		if (n.type === 'ExportNamedDeclaration' && n.declaration === null) continue;
		if (n.type === 'ImportDeclaration') {
			if (options.output === undefined)
				throw new Error(
					`ambient: ${options.signatures} imports; say where the ambient file goes (\`output\`) so its imports can be rewritten.`
				);
			helpers.push(rebased(code, n, options.signatures, options.output));
			continue;
		}
		const text = code.slice(start, n.end);
		if (n.type !== 'ExportNamedDeclaration') {
			helpers.push(text);
			continue;
		}
		const name = nameOf(n.declaration);
		if (!name.startsWith('$')) {
			helpers.push(text.replace(/(^|\n)export /, '$1'));
			continue;
		}
		exported.add(name);
		globals.push(text.replace(/(^|\n)export (declare )?/, '$1'));
	}
	const owned = new Set(options.macros.flatMap((m) => m.names));
	for (const name of owned)
		if (!exported.has(name))
			throw new Error(
				`ambient: the macro name \`${name}\` has no signature: export it from ${options.signatures}.`
			);
	for (const name of exported)
		if (!owned.has(name))
			throw new Error(`ambient: ${options.signatures} exports \`${name}\`, which no macro owns.`);
	return declarations({
		header: options.header,
		macros: [
			{
				helpers: helpers.length === 0 ? undefined : helpers.join('\n'),
				types: globals.join('\n\n')
			}
		]
	});
}
