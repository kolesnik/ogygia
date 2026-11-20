/**
 * `$dev(…)` and `$rules(…)`, at a function's definition (`const check: (n: number) => void =
 * $dev(function check(n: number): void { … })`): the function runs behind that gate. The definition
 * compiles to the plain function; its calls, in its own module or any module that imports it,
 * compile to `<gate> && check(…)`, so a build where the gate is false folds them, and with nothing
 * left calling the function its body goes too.
 *
 * Refused at build: a mark anywhere but a function's definition at the top of its module (a const
 * of the function's own name, the mark's only argument); an async or generator function; a type on
 * the const whose parameters are not the function's; a marked function handed on as a value, or
 * called where its result is read (a build without the gate has no result); a marked function
 * re-exported, or its module imported whole (`import * as`, `export *`), since the calls through
 * either could not be found.
 *
 * @packageDocumentation
 */
import { gated, type N, type Pass, type Visit } from 'ogygia-internal-compilerkit';
import { walk } from 'zimmerframe';
import { code } from 'ogygia-internal-compilerkit';
import { marked_in, imported_marks, marked_definition, marks_of } from './marks.ts';
import { resolveSpecifier } from 'ogygia-internal-compilerkit';
import type { Scope } from 'periscopic';
import type { Compiler } from './compiler.ts';
import { GATES } from './gates.ts';
import { GATE_MARKS } from './marks.ts';

const say_shape = (mark: string) =>
	`${mark} marks a function where it is defined: \`const name: (…) => void = ${mark}(function name(…): void { … })\` at the top of its module.`;

/** The gating marks' pass. */
export class GatePass implements Pass<Scope> {
	readonly #c: Compiler;
	/** The marked functions this module may call: its own and those it imports, name → mark. */
	readonly #marked = new Map<string, string>();
	/** The marked definitions, by their declaration (each compiles to its function). */
	readonly #placed = new Map<N, N>();

	constructor(c: Compiler) {
		this.#c = c;
	}

	prepare(): void {
		const { program, report, options } = this.#c;
		for (const [name, mark] of marks_of(program)) this.#marked.set(name, mark);
		for (const statement of program.body as Array<N>) {
			const d = marked_definition(statement);
			if (d === null) continue;
			if (!d.named || !d.alone) report.fail(d.declarator, say_shape(d.mark));
			if (d.fn.async || d.fn.generator)
				report.fail(
					d.fn,
					`${d.mark} marks a plain function: an async or generator one returns a value, which a build without the gate has not.`
				);
			const typed = d.declarator.id.typeAnnotation?.typeAnnotation;
			if (typed?.type === 'TSFunctionType' && typed.params.length !== d.fn.params.length)
				report.fail(
					typed,
					`${d.declarator.id.name} is typed with ${typed.params.length} parameter${typed.params.length === 1 ? '' : 's'}, its function takes ${d.fn.params.length}: write the same parameters on both.`
				);
			this.#placed.set(
				statement.type === 'ExportNamedDeclaration' ? statement.declaration : statement,
				d.fn
			);
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
						(up?.type === 'VariableDeclarator' && up.id === n) ||
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

	statement(node: N, v: Visit<Scope>): boolean {
		const fn = this.#placed.get(node);
		if (fn === undefined) return false;
		const e = this.#c.emitter;
		e.rewrite(node, code`${fn}`);
		e.added += 1;
		this.#c.walk_node(fn.body, v.scope);
		return true;
	}

	call(node: N, v: Visit<Scope>): boolean {
		const callee = node.callee;
		if (callee?.type !== 'Identifier') return false;
		if (Object.hasOwn(GATE_MARKS, callee.name)) this.#c.report.fail(node, say_shape(callee.name));
		const mark = this.#marked.get(callee.name);
		if (mark === undefined || v.scope.find_owner(callee.name) !== this.#c.tracker.root)
			return false;
		gated(this.#c.emitter, node, GATES.get(GATE_MARKS[mark]!)!);
		v.next();
		return true;
	}
}
