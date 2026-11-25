/**
 * Types are output too. A macro's definition holds its typed signature (the declaration source of
 * the globals it owns, docs included), so the declarations source files type-check against are
 * generated from the definitions, never kept by hand:
 *
 * - `declarations(...)` writes one ambient `.d.ts`: each macro's module-level helper types, then
 *   its globals inside `declare global`. A repository commits it and checks it is fresh, as it
 *   does its generated modules (`writeGenerated`).
 * - `publishedTypes(...)` checks a build's published `.d.ts`: no name the build shortens, and no
 *   macro type, ever reaches an app.
 *
 * @packageDocumentation
 */
import { endsInDollar, type Shortened } from './shorten.ts';

/** A macro's typed signature: declaration source, as written in a `.d.ts`. */
export interface Typed {
	/** Module-level helper types its globals use (not global themselves). */
	readonly helpers?: string;
	/** Its globals' declarations, as written inside `declare global { … }`. */
	readonly types?: string;
}

/** Declaration source, its common indent taken off (the tag also lets an editor highlight it). */
export function dts(strings: TemplateStringsArray, ...values: ReadonlyArray<string>): string {
	const lines = String.raw({ raw: strings }, ...values)
		.replace(/^\n+|\s+$/g, '')
		.split('\n');
	const margin = Math.min(
		...lines.filter((l) => l.trim() !== '').map((l) => l.match(/^ */)![0].length)
	);
	return lines.map((l) => l.slice(margin)).join('\n');
}

const indent = (text: string): string =>
	text
		.replace(/^\n+|\s+$/g, '')
		.split('\n')
		.map((line) => (line === '' ? '' : `  ${line}`))
		.join('\n');

const trimmed = (text: string): string => text.replace(/^\n+|\s+$/g, '');

/**
 * The ambient declarations of `macros`, in order: a header comment, every macro's helpers, then
 * every macro's globals in one `declare global`.
 */
export function declarations(options: {
	/** The file's leading comment, each line without its `// `. */
	readonly header: ReadonlyArray<string>;
	readonly macros: ReadonlyArray<Typed>;
}): string {
	const head = options.header.map((line) => `// ${line}`.trimEnd()).join('\n');
	const helpers = options.macros
		.map((m) => m.helpers)
		.filter((h): h is string => h !== undefined)
		.map(trimmed);
	const globals = options.macros
		.map((m) => m.types)
		.filter((t): t is string => t !== undefined)
		.map(indent);
	const global = `declare global {
${globals.join('\n\n')}
}`;
	return `${[head, 'export {}', ...helpers, global].join('\n\n')}\n`;
}

/** What a published declaration file must not hold. */
export interface PublishedRules {
	/** Names the build shortens (default: a name ending in `$`). */
	readonly shortened?: Shortened;
	/** Macro names, which exist only at build time. */
	readonly macros?: ReadonlyArray<string>;
}

const NAME = /(?:[A-Za-z_]|\$(?!\{))(?:[A-Za-z0-9_]|\$(?!\{))*/g;

/** The problems in one published `.d.ts`, each naming the file, line and name. Comments are
 *  prose, not types: only code is read. */
export function publishedTypes(
	file: string,
	text: string,
	rules: PublishedRules = {}
): Array<string> {
	const shortened = rules.shortened ?? endsInDollar;
	const problems: Array<string> = [];
	const code = text.replace(/\/\*[^]*?\*\/|\/\/[^\n]*/g, (comment) =>
		comment.replace(/[^\n]/g, ' ')
	);
	code.split('\n').forEach((line, i) => {
		for (const word of line.match(NAME) ?? []) {
			if (shortened(word))
				problems.push(
					`${file}:${i + 1}: \`${word}\` is shortened in the build: no published type names it.`
				);
			if (rules.macros?.includes(word) === true)
				problems.push(`${file}:${i + 1}: \`${word}\` is a macro: it exists only at build time.`);
		}
	});
	return problems;
}
