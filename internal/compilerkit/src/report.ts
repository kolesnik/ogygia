/**
 * Build errors: the first one stops the build and names the file, line and column. Warnings name
 * what the build could not prove and let it go on.
 *
 * @packageDocumentation
 */

/** A build error at a place in a file: `file:line:column  message`. */
export class MacroError extends Error {
	file: string;
	line: number;
	column: number;
	constructor(message: string, file: string, line: number, column: number) {
		super(`${file}:${line}:${column}  ${message}`);
		this.name = 'MacroError';
		this.file = file;
		this.line = line;
		this.column = column;
	}
}

/** Build errors with locations. The first one stops the build: no silent fallback. Warnings
 *  name what the build cannot prove and let it go on. */
export class Report {
	readonly code: string;
	readonly file: string;
	readonly warnings: Array<string> = [];
	constructor(code: string, file: string) {
		this.code = code;
		this.file = file;
	}

	fail(node: { start: number } | null | undefined, message: string): never {
		const [line, column] = this.lineOf(node?.start ?? 0);
		throw new MacroError(message, this.file, line, column);
	}

	warn(node: { start: number }, message: string): void {
		const [line, column] = this.lineOf(node.start);
		this.warnings.push(`${this.file}:${line}:${column}  ${message}`);
	}

	/** `file:line` of a node, as `debug.json` and messages show it. */
	where(node: { start: number }): string {
		return `${this.file}:${this.lineOf(node.start)[0]}`;
	}

	lineOf(offset: number): [number, number] {
		let line = 1;
		let last = -1;
		for (let i = 0; i < offset; i++)
			if (this.code.charCodeAt(i) === 10) {
				line++;
				last = i;
			}
		return [line, offset - last];
	}
}
