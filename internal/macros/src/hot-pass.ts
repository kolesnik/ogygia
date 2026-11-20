/**
 * `$hot` and `$layout`, checks only (they compile to the function they mark):
 *
 * - `const f: F = $hot(function f(…) { … })`: a function on a per-event or per-turn path. The build
 *   reads it with compilerkit's could-allocate analysis and fails, naming file and line, at anything
 *   that may allocate (a literal, a closure, `new`, a template, a spread, an iterator, …) or force a
 *   layout. A call is allowed only into another `$hot` function (here or through a relative import),
 *   a global that makes nothing (`Math.*`), or a method that never allocates (./hot.ts).
 * - `const g: G = $layout(function g(…) { … })`: a function that forces a layout. A `$hot` function
 *   that calls one fails.
 * - `$hot.allow('<name>', expr)`, inside a `$hot` function: an allocation made on purpose, by a name
 *   from the closed list in ./hot.ts. It compiles to `expr`.
 *
 * @packageDocumentation
 */
import { code, macroName, type N, type Pass, type Visit } from 'ogygia-internal-compilerkit';
import { allocations, pureCall } from 'ogygia-internal-compilerkit/alloc';
import { walk } from 'zimmerframe';
import type { Scope } from 'periscopic';
import type { Compiler } from './compiler.ts';
import { HOT_EXCEPTIONS, LAYOUT_CALLS, LAYOUT_READS, PURE_METHODS } from './hot.ts';
import { imported_marks, marked_definition, marks_of } from './marks.ts';

/** The `$hot` / `$layout` pass. */
export class HotPass implements Pass<Scope> {
	readonly #c: Compiler;
	/** The `$hot.allow` calls inside `$hot` functions (each compiles to its expression). */
	readonly #allowed = new Set<N>();

	constructor(c: Compiler) {
		this.#c = c;
	}

	prepare(): void {
		const { program, report, options } = this.#c;
		const marks = marks_of(program);
		if (options.path !== undefined)
			for (const [local, mark] of imported_marks(options.path, program)) marks.set(local, mark);
		for (const statement of program.body as Array<N>) {
			const d = marked_definition(statement);
			if (d === null || d.mark !== '$hot') continue;
			const name = d.declarator.id.name as string;
			const found = allocations(d.fn, {
				skip: (node) => {
					if (macroName(node) !== '$hot.allow') return false;
					const [label] = node.arguments;
					if (label?.type !== 'Literal' || !Object.hasOwn(HOT_EXCEPTIONS, String(label.value)))
						report.fail(
							node,
							`$hot.allow names an exception from the closed list (internal/macros/src/hot.ts: ${Object.keys(HOT_EXCEPTIONS).join(', ')}).`
						);
					this.#allowed.add(node);
					return true;
				},
				call: (node) => {
					const callee = node.callee;
					if (callee.type === 'Identifier') {
						const mark = marks.get(callee.name);
						if (mark === '$hot') return null;
						if (mark === '$layout')
							return `a call into ${callee.name}, which forces a layout ($layout)`;
						if (pureCall(node, () => null)) return null;
						return `a call into ${callee.name}, which is not $hot`;
					}
					if (callee.type === 'MemberExpression' && !callee.computed) {
						const method = callee.property.name as string;
						if (LAYOUT_CALLS.has(method)) return `.${method}(), which forces a layout`;
						if (pureCall(node, () => null) || PURE_METHODS.has(method)) return null;
						return `a call of .${method}(…), which may allocate`;
					}
					return 'a call through an expression, which may allocate';
				}
			});
			walk(d.fn.body as N, null, {
				MemberExpression(node: N, { next }) {
					if (!node.computed && LAYOUT_READS.has(node.property.name))
						found.push({ node, what: `a read of .${node.property.name}, which forces a layout` });
					next();
				}
			});
			if (found.length !== 0)
				report.fail(
					found[0]!.node,
					`${name} is $hot: ${found[0]!.what}. Make it without, or name the exception: $hot.allow('<name>', …) from internal/macros/src/hot.ts.`
				);
		}
	}

	call(node: N, v: Visit<Scope>): boolean {
		const mark = macroName(node);
		if (mark === '$hot' || mark === '$layout')
			this.#c.report.fail(
				node,
				`${mark} marks a function where it is defined: \`const name: (…) => R = ${mark}(function name(…) { … })\` at the top of its module.`
			);
		if (mark !== '$hot.allow') return false;
		if (!this.#allowed.has(node))
			this.#c.report.fail(node, '$hot.allow marks an allocation inside a $hot function.');
		this.#c.emitter.rewrite(node, code`${node.arguments[1]}`);
		v.next();
		return true;
	}
}
