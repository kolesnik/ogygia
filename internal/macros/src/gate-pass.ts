/**
 * `$dev()` and `$rules()`: a function whose first statement is one runs behind that gate. Its
 * calls, in its own module or any module that imports it, compile to `<gate> && name(…)`, so a
 * build where the gate is false folds them, and with nothing left calling the function its body
 * goes too. The mark itself compiles away.
 *
 * Refused at build: a mark anywhere but the first statement of a top-level function declaration
 * (or with arguments, or in an async or generator function); a marked function handed on as a
 * value, or called where its result is read (a build without the gate has no result); a marked
 * function re-exported, or its module imported whole (`import * as`, `export *`), since the calls
 * through either could not be found.
 *
 * @packageDocumentation
 */
import { gated, type N, type Pass, type Visit } from 'ogygia-internal-compilerkit';
import { walk } from 'zimmerframe';
import { marked_in, imported_marks, mark_statement, marks_of, top_function } from './marks.ts';
import { resolveSpecifier } from 'ogygia-internal-compilerkit';
import type { Scope } from 'periscopic';
import type { Compiler } from './compiler.ts';
import { GATES } from './gates.ts';
import { GATE_MARKS } from './marks.ts';

const SHAPE =
	'marks the function it is the first statement of: `function name(…): void { $MARK(); … }` at the top of its module.';
const say_shape = (mark: string) => `${mark}() ${SHAPE.replace('$MARK', mark)}`;

/** The gating marks' pass. */
export class GatePass implements Pass<Scope> {
	readonly #c: Compiler;
	/** The marked functions this module may call: its own and those it imports, name → mark. */
	readonly #marked = new Map<string, string>();
	/** The mark statements that are well placed (each compiles away). */
	readonly #placed = new Set<N>();

	constructor(c: Compiler) {
		this.#c = c;
	}

	prepare(): void {
		const { program, report, options } = this.#c;
		for (const [name, mark] of marks_of(program)) this.#marked.set(name, mark);
		for (const statement of program.body as Array<N>) {
			const fn = top_function(statement);
			const first = fn?.body?.body?.[0];
			if (fn === null || mark_statement(first) === null) continue;
			const mark = mark_statement(first)!;
			if (first.expression.arguments.length !== 0)
				report.fail(first, `${mark}() takes nothing: ${say_shape(mark)}`);
			if (fn.async || fn.generator)
				report.fail(
					fn,
					`${mark}() marks a plain function: an async or generator one returns a value, which a build without the gate has not.`
				);
			this.#placed.add(first);
		}
		if (options.path !== undefined) {
			for (const [local, mark] of imported_marks(options.path, program))
				this.#marked.set(local, mark);
			for (const statement of program.body as Array<N>)
				this.#whole_imports(statement, options.path);
		}
		const misuse = this.#marked.size === 0 ? null : this.#first_misuse();
		if (misuse?.how === 'value')
			report.fail(
				misuse.node,
				`${misuse.name} runs behind the ${GATE_MARKS[this.#marked.get(misuse.name)!]} gate (${this.#marked.get(misuse.name)}): call it, never hand it on as a value.`
			);
		if (misuse?.how === 'expression')
			report.fail(
				misuse.node,
				`${misuse.name}(…) runs behind the ${GATE_MARKS[this.#marked.get(misuse.name)!]} gate (${this.#marked.get(misuse.name)}): its call is a statement, since a build without the gate has no result.`
			);
	}

	/** The first use of a marked function (resolved at the module's top, so a local of the same
	 *  name is its own) but as a call that is a statement, its declaration, an import or export of
	 *  it, or a key or member of its name. */
	#first_misuse(): { node: N; name: string; how: 'value' | 'expression' } | null {
		const { tracker, program } = this.#c;
		const marked = this.#marked;
		const found: Array<{ node: N; name: string; how: 'value' | 'expression' }> = [];
		walk(program as N, tracker.root, {
			_(n: N, { path, state, next }) {
				if (found.length !== 0) return;
				const scope = tracker.scopeAt(n, state);
				if (n.type === 'Identifier' && marked.has(n.name)) {
					const up = path.at(-1);
					const named =
						(up?.type === 'FunctionDeclaration' && up.id === n) ||
						up?.type === 'ImportSpecifier' ||
						up?.type === 'ExportSpecifier' ||
						(up?.type === 'MemberExpression' && up.property === n && !up.computed) ||
						(up?.type === 'Property' && up.key === n && !up.shorthand) ||
						String(up?.type).startsWith('TS');
					const called = up?.type === 'CallExpression' && up.callee === n;
					if (!named && scope.find_owner(n.name) === tracker.root) {
						if (!called) found.push({ node: n, name: n.name, how: 'value' });
						else if (path.at(-2)?.type !== 'ExpressionStatement')
							found.push({ node: up, name: n.name, how: 'expression' });
					}
				}
				next(scope);
			}
		});
		return found[0] ?? null;
	}

	/** A re-export of a marked function, or a whole-module import or re-export of a module that
	 *  marks one, is refused: the calls through it could not be found. */
	#whole_imports(statement: N, path: string): void {
		const source = statement.source?.value;
		if (typeof source !== 'string') return;
		const file = resolveSpecifier(path, source);
		const marks = file === null ? null : marked_in(file);
		if (marks === null || marks.size === 0) return;
		const report = this.#c.report;
		if (statement.type === 'ExportAllDeclaration')
			report.fail(
				statement,
				`export * from '${source}' re-exports its marked functions (${[...marks.keys()].join(', ')}): import each from its own module where it is called.`
			);
		if (statement.type === 'ExportNamedDeclaration')
			for (const spec of statement.specifiers)
				if (marks.has(spec.local.name ?? spec.local.value))
					report.fail(
						spec,
						`${spec.local.name} runs behind a gate (${marks.get(spec.local.name)}): import it from its own module where it is called, never through a re-export.`
					);
		if (statement.type === 'ImportDeclaration' && statement.importKind !== 'type')
			for (const spec of statement.specifiers)
				if (spec.type === 'ImportNamespaceSpecifier')
					report.fail(
						spec,
						`import * from '${source}' hides the calls of its marked functions (${[...marks.keys()].join(', ')}): import each by name.`
					);
	}

	statement(node: N): boolean {
		if (!this.#placed.has(node)) return false;
		this.#c.emitter.replace(node, '');
		return true;
	}

	call(node: N, v: Visit<Scope>): boolean {
		const callee = node.callee;
		if (callee?.type !== 'Identifier') return false;
		if (Object.hasOwn(GATE_MARKS, callee.name)) {
			if (v.parent?.type !== 'ExpressionStatement' || !this.#placed.has(v.parent))
				this.#c.report.fail(node, say_shape(callee.name));
			return true;
		}
		const mark = this.#marked.get(callee.name);
		if (mark === undefined || v.scope.find_owner(callee.name) !== this.#c.tracker.root)
			return false;
		gated(this.#c.emitter, node, GATES.get(GATE_MARKS[mark]!)!);
		v.next();
		return true;
	}
}
