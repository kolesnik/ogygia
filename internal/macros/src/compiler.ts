/**
 * One compile of one file: the options, the report, the emitter and every macro's pass over one
 * parse. The vocabulary is the macros' names; Svelte's runes are never one.
 *
 * @packageDocumentation
 */
import {
	Emitter,
	Report,
	namesOf,
	parse,
	runtimeOf,
	vocabulary,
	walkPasses,
	type Mode,
	type N,
	type Pass
} from 'ogygia-internal-compilerkit';
import { MACROS } from './macros.ts';

export type { Mode };

/** How one file compiles. */
export interface CompileOptions {
	readonly mode: Mode;
	/** Where compiled output imports the macros' runtime from. */
	readonly runtime: string;
	/** Where reference output imports the reference implementation from. */
	readonly reference: string;
}

/** A compiled file. */
export interface CompileResult {
	readonly code: string;
	readonly map: ReturnType<Emitter['s']['generateMap']>;
	/** What the build could not prove, by place. */
	readonly warnings: ReadonlyArray<string>;
}

/** Svelte's runes: never a macro name, so a macro and a rune never share one. */
export const RESERVED: ReadonlyArray<string> = [
	'$state',
	'$derived',
	'$effect',
	'$props',
	'$bindable',
	'$inspect',
	'$host'
];

/** Every global name the macros own. */
export const VOCABULARY: ReadonlyArray<string> = namesOf(MACROS);

const WORDS = vocabulary(VOCABULARY, RESERVED, "reserved for Svelte's runes");

/** One compile of one file. */
export class Compiler {
	readonly options: CompileOptions;
	readonly report: Report;
	readonly program: N;
	readonly emitter: Emitter;
	/** The macros the file uses (read from the tree: a comment or a string names none). */
	readonly uses: ReadonlySet<string>;
	readonly #passes: ReadonlyArray<Pass>;

	/** A cheap text test before parsing: false means the file surely uses no macro. */
	static may_want(code: string): boolean {
		return WORDS.mayUse(code);
	}

	constructor(code: string, file: string, options: CompileOptions) {
		this.options = options;
		this.report = new Report(code, file);
		this.program = parse(code, this.report);
		this.uses = WORDS.usedIn(this.program);
		this.emitter = new Emitter(code, this.report, new Set());
		this.#passes = MACROS.map((m) => m.pass(this));
	}

	run(): CompileResult {
		for (const p of this.#passes) p.prepare?.();
		walkPasses(this.program, null, this.#passes, (_node, scope) => scope);
		for (const p of this.#passes) p.done?.();
		const code = this.emitter.finish(runtimeOf(this.options), this.program);
		return {
			code,
			map: this.emitter.s.generateMap({
				source: this.report.file,
				includeContent: true,
				hires: true
			}),
			warnings: this.report.warnings
		};
	}
}
