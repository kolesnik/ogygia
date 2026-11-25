/**
 * Types at build: one TypeScript Program over a project (its tsconfig), shared by every file a
 * build compiles, for a macro that must know what an expression's type is (a call site that does
 * not say which definition it belongs to).
 *
 * - The Program is made on first need, once per build, and made again incrementally (the old
 *   Program's unchanged files are reused) when a file is compiled from text other than what the
 *   Program read: a watch rebuild, or a plugin before the macros that changed the file.
 * - A node of a compile's own parse is found in the Program by its place (`nodeAt`): the parse and
 *   the Program read the same text, so the same span is the same node.
 *
 * @packageDocumentation
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import ts from 'typescript';

export { ts };

/** One file of the Program, as a compile asks about it. */
export interface TypedFile {
	readonly file: ts.SourceFile;
	readonly checker: ts.TypeChecker;
	readonly program: ts.Program;
}

/** A Program over one tsconfig, made on first need and updated file by file. */
export class TypedProgram {
	readonly tsconfig: string;
	#program: ts.Program | null = null;
	#roots: readonly string[] = [];
	#options: ts.CompilerOptions = {};
	/** Texts that differ from the disk: the compiled code, by absolute file. */
	readonly #texts = new Map<string, string>();
	/** How many times the Program was made (the first time, and each update). */
	builds = 0;
	/** The milliseconds spent making it, all builds together. */
	ms = 0;

	constructor(tsconfig: string) {
		this.tsconfig = resolve(tsconfig);
	}

	/** The Program, made now if it was not yet. */
	get program(): ts.Program {
		return this.#program ?? this.#make();
	}

	/** `file` (absolute) in the Program, read as `code`: the Program is updated first when it read
	 *  other text. Null when the file is not in the project. */
	at(file: string, code: string): TypedFile | null {
		let program = this.program;
		let sf = program.getSourceFile(file);
		if (sf === undefined) return null;
		if (sf.text !== code) {
			this.#texts.set(file, code);
			program = this.#make();
			sf = program.getSourceFile(file)!;
		}
		return { file: sf, checker: program.getTypeChecker(), program };
	}

	#make(): ts.Program {
		const started = performance.now();
		if (this.#program === null) {
			const read = ts.readConfigFile(this.tsconfig, (p) => readFileSync(p, 'utf8'));
			if (read.error !== undefined)
				throw new Error(
					`compilerkit: ${this.tsconfig}: ${ts.flattenDiagnosticMessageText(read.error.messageText, '\n')}`
				);
			const parsed = ts.parseJsonConfigFileContent(read.config, ts.sys, dirname(this.tsconfig));
			this.#roots = parsed.fileNames;
			this.#options = { ...parsed.options, noEmit: true };
		}
		const host = ts.createCompilerHost(this.#options, true);
		const texts = this.#texts;
		const old = this.#program;
		const read_file = host.getSourceFile.bind(host);
		host.getSourceFile = (name, version, onError, fresh) => {
			const text = texts.get(resolve(name));
			const kept = old?.getSourceFile(name);
			if (text === undefined) return kept ?? read_file(name, version, onError, fresh);
			return kept?.text === text ? kept : ts.createSourceFile(name, text, version, true);
		};
		this.#program = ts.createProgram({
			rootNames: this.#roots,
			options: this.#options,
			host,
			oldProgram: this.#program ?? undefined
		});
		this.builds++;
		this.ms += performance.now() - started;
		return this.#program;
	}
}

/** The node of `file` spanning exactly `start` to `end` (the outermost one), or null. */
export function nodeAt(file: ts.SourceFile, start: number, end: number): ts.Node | null {
	let found: ts.Node | null = null;
	const visit = (n: ts.Node): void => {
		if (found !== null || n.end < end || n.pos > start) return;
		if (n.getStart(file) === start && n.end === end) {
			found = n;
			return;
		}
		ts.forEachChild(n, visit);
	};
	ts.forEachChild(file, visit);
	return found;
}
