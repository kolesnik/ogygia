/**
 * The emitter: every edit a compile makes, on the original text (MagicString), so a node's own
 * edits survive the edits around it. It names the runtime's members through one namespace import
 * (`import * as $ from '<runtime>'`, then only static `$.name` reads, so a bundler still drops
 * what a file doesn't call), hands out collision-free local names, hoists helpers to the top,
 * and parses its output again: it must parse, and no statement may have merged into another.
 *
 * Expansions are written as templates (`rewrite(node, code\`…\`)`): text, and the nodes of the
 * source kept in place with their edits.
 *
 * @packageDocumentation
 */
import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';
import { countStatements, type N } from './ast.ts';
import type { Report } from './report.ts';

/** A template's parts: text, and source nodes kept as they are (with their own edits). */
export type Part = N;

/**
 * A template: `code\`${e.name('go')}(${target}, ${arg})\`` is the text around, and each node
 * kept where it is. Strings interpolated are text; nodes are kept.
 */
export function code(strings: TemplateStringsArray, ...values: ReadonlyArray<Part>): Array<Part> {
	const out: Array<Part> = [];
	strings.forEach((text, i) => {
		if (text !== '') out.push(text);
		if (i < values.length) out.push(values[i]);
	});
	return out;
}

const isNode = (part: Part): part is N =>
	typeof part === 'object' &&
	part !== null &&
	typeof part.start === 'number' &&
	typeof part.end === 'number';

/** Edits on the original text, readable collision-free names, imports, and the re-parse check. */
export class Emitter {
	readonly s: MagicString;
	readonly report: Report;
	readonly taken: Set<string>;
	readonly used = new Set<string>();
	/** Top-level helpers the passes write (tables, hoisted functions), by name. */
	readonly hoisted: Array<string> = [];
	/** Statements a pass adds on purpose (`if (…) enter()` around a call). */
	added = 0;

	constructor(code: string, report: Report, taken: Set<string>) {
		this.s = new MagicString(code);
		this.report = report;
		this.taken = taken;
	}

	/**
	 * A runtime member, read through the file's one namespace import: `$.go`. Only static member
	 * access is ever written, so bundlers still drop the members a file doesn't call. The namespace
	 * is `$`, or `$1`, `$2`… when the file already binds `$`.
	 */
	name(base: string): string {
		this.used.add(base);
		return `${this.namespace()}.${base}`;
	}

	private ns: string | null = null;

	private namespace(): string {
		if (this.ns !== null) return this.ns;
		let n = '$';
		for (let i = 1; this.taken.has(n); i++) n = `$${i}`;
		this.taken.add(n);
		return (this.ns = n);
	}

	/** A fresh local name, not imported: for hoisted tables and variables. */
	fresh(base: string): string {
		let n = base;
		for (let i = 1; this.taken.has(n); i++) n = `${base}_${i}`;
		this.taken.add(n);
		return n;
	}

	/** A node's original text. */
	text(node: N): string {
		return this.s.original.slice(node.start, node.end);
	}

	/** Replaces a node; the statements inside it are counted out, so the re-parse check still holds. */
	replace(node: N, text: string): void {
		this.added -= countStatements(node);
		this.s.overwrite(node.start, node.end, text);
	}

	/**
	 * Rewrites `node` as a template: its text parts written around the nodes it keeps, which stay
	 * in place with their own edits. The kept nodes lie inside `node`, in source order. The
	 * statements of what is dropped are counted out; a template that writes statements of its own
	 * counts them in `added`.
	 */
	rewrite(node: N, parts: ReadonlyArray<Part>): void {
		let at: number = node.start;
		let text = '';
		let dropped = countStatements(node);
		const gap = (end: number) => {
			if (end > at && text === '') this.s.remove(at, end);
			else if (end > at) this.s.overwrite(at, end, text);
			else if (text !== '') this.s.appendLeft(at, text);
			text = '';
		};
		for (const part of parts) {
			if (!isNode(part)) {
				text += part;
				continue;
			}
			if (part.start < at || part.end > node.end)
				this.report.fail(
					part,
					'a template keeps the nodes inside what it rewrites, in source order.'
				);
			gap(part.start);
			dropped -= countStatements(part);
			at = part.end;
		}
		gap(node.end);
		this.added -= dropped;
	}

	/** `head` + the kept `data` expression + `tail`, so edits inside `data` survive. */
	wrap(node: N, data: N, head: string, tail: string): void {
		if (data === undefined) {
			this.s.overwrite(node.start, node.end, head + tail);
			return;
		}
		this.s.overwrite(node.start, data.start, `${head}, `);
		this.s.overwrite(data.end, node.end, tail);
	}

	/**
	 * Text that replaces an expression statement with an `if`: braced unless the statement sits in a
	 * block, so a later `else` can't bind to the new `if`.
	 */
	ifStatement(path: ReadonlyArray<N>, head: string): [string, string] {
		const holder = path.at(-2)?.type;
		const bare =
			holder === 'BlockStatement' ||
			holder === 'Program' ||
			holder === 'SwitchCase' ||
			holder === 'StaticBlock';
		return bare ? [head, ''] : [`{ ${head}`, ' }'];
	}

	/** `target.fn(a, b)` → `fn(target, a, b)`, keeping the arguments' own edits. */
	call(node: N, fn: string, target: string): void {
		const first = node.arguments[0];
		const types = node.typeArguments;
		const head = this.name(fn);
		if (first === undefined) {
			const args = types ? this.text(types) : '';
			this.replace(node, `${head}${args}(${target})`);
		} else if (types) {
			this.s.overwrite(node.callee.start, types.start, head);
			this.s.overwrite(types.end, first.start, `(${target}, `);
		} else this.s.overwrite(node.callee.start, first.start, `${head}(${target}, `);
	}

	/** The output: hoisted helpers, the runtime's import, then the edited text; parsed again. */
	finish(spec: string, program: N): string {
		if (this.hoisted.length !== 0) this.s.prepend(`${this.hoisted.join('\n')}\n`);
		if (this.used.size !== 0) this.s.prepend(`import * as ${this.ns} from '${spec}'\n`);
		const out = this.s.toString();
		this.check(out, program);
		return out;
	}

	/** Every output is parsed again: it must parse, and no statement may merge into another (ASI). */
	private check(out: string, program: N): void {
		const again = parseSync(this.report.file, out, {
			lang: 'ts',
			sourceType: 'module'
		});
		if (again.errors.length !== 0)
			this.report.fail(
				null,
				`the compiler wrote code that doesn't parse: ${again.errors[0]!.message}`
			);
		const want =
			countStatements(program) + this.added + this.hoisted.length + (this.used.size ? 1 : 0);
		const got = countStatements(again.program);
		if (got !== want)
			this.report.fail(
				null,
				`the compiler's output has ${got} statements where ${want} were expected: an edit merged or split one.`
			);
	}
}
