/**
 * `$await(wait)`: an await of something that may settle `STALE` (a scope's `task`, a machine's or a
 * turn's `wait`, a mailbox's `ask`), and the check right after it, written by the build:
 *
 *   $await(turn.wait(ready));               → if ((await turn.wait(ready)) === STALE) return;
 *   const v = $await(scope.task(f));        → const v = await scope.task(f);
 *                                             if (v === STALE) return;
 *   v = $await(scope.task(f));              → v = await scope.task(f); if (v === STALE) return;
 *   $await(scope.task(f), fallback);        → … return fallback;   (evaluated only then)
 *
 * Refused at build: `$await` anywhere but those three places, or outside an async function; and a
 * plain `await` of a `.task(…)`, `.wait(…)` or `.ask(…)` call (or a `.catch`/`.then` of one) in any
 * file the macros compile, so a missing STALE check cannot be written.
 *
 * @packageDocumentation
 */
import { code, type N, type Pass, type Visit } from 'ogygia-internal-compilerkit';
import { rawAwaits } from 'ogygia-internal-compilerkit/sentinel';
import type { Scope } from 'periscopic';
import type { Compiler } from './compiler.ts';

/** Where `STALE` comes from. */
export const SENTINEL = { from: '@ogygia/machine', name: 'STALE' } as const;

const STALE_METHODS: ReadonlySet<string> = new Set(['task', 'wait', 'ask']);
const CHAINED: ReadonlySet<string> = new Set(['catch', 'then', 'finally']);

/** Whether `node` is a call that may settle `STALE`: `x.task(…)`, `x.wait(…)`, `x.ask(…)`, or a
 *  `.catch`/`.then`/`.finally` of one. */
export function may_be_stale(node: N): boolean {
	while (node?.type === 'TSAsExpression' || node?.type === 'ParenthesizedExpression')
		node = node.expression;
	if (node?.type !== 'CallExpression') return false;
	const callee = node.callee;
	if (callee.type !== 'MemberExpression' || callee.computed) return false;
	const name = callee.property.name as string;
	if (STALE_METHODS.has(name)) return true;
	return CHAINED.has(name) && may_be_stale(callee.object);
}

const FUNCTION_RE = /^(?:Arrow)?Function(?:Expression|Declaration)$/;

/** The `$await` pass. */
export class AwaitPass implements Pass<Scope> {
	readonly #c: Compiler;
	#stale: string | null = null;

	constructor(c: Compiler) {
		this.#c = c;
	}

	prepare(): void {
		const raw = rawAwaits(this.#c.program, may_be_stale);
		if (raw.length !== 0)
			this.#c.report.fail(
				raw[0],
				'an await of a .task(…), .wait(…) or .ask(…) is written $await(…): it may settle STALE, and the check after it is the build’s.'
			);
	}

	/** The file's name for `STALE`: its own import of it, else one the output adds. */
	#sentinel(): string {
		if (this.#stale !== null) return this.#stale;
		for (const statement of this.#c.program.body as Array<N>) {
			if (statement.type !== 'ImportDeclaration' || statement.source.value !== SENTINEL.from)
				continue;
			if (statement.importKind === 'type') continue;
			for (const spec of statement.specifiers)
				if (
					spec.type === 'ImportSpecifier' &&
					spec.importKind !== 'type' &&
					(spec.imported.name ?? spec.imported.value) === SENTINEL.name
				)
					return (this.#stale = spec.local.name as string);
		}
		return (this.#stale = this.#c.emitter.imported(SENTINEL.from, SENTINEL.name));
	}

	call(node: N, v: Visit<Scope>): boolean {
		if (node.callee?.type !== 'Identifier' || node.callee.name !== '$await') return false;
		const { report, emitter: e } = this.#c;
		const [wait, give_up, extra] = node.arguments;
		if (wait === undefined || extra !== undefined || wait.type === 'SpreadElement')
			report.fail(node, '$await(wait) takes the wait, and what to return when it settles STALE.');
		const fn = [...v.path].reverse().find((p) => FUNCTION_RE.test(p.type));
		if (fn === undefined || !fn.async)
			report.fail(node, '$await(…) is an await: it sits in an async function.');
		const holder = v.parent;
		const stale = this.#sentinel();
		if (holder?.type === 'ExpressionStatement') {
			const [head, tail] = e.ifStatement(v.path.slice(0, -1).concat(holder), '');
			e.rewrite(
				holder,
				give_up === undefined
					? code`${head}if ((await ${wait}) === ${stale}) return;${tail}`
					: code`${head}if ((await ${wait}) === ${stale}) return ${give_up};${tail}`
			);
			e.added += 2;
		} else if (
			holder?.type === 'VariableDeclarator' &&
			holder.init === node &&
			holder.id.type === 'Identifier' &&
			v.path.at(-2)?.declarations.length === 1
		) {
			this.#check_after(v.path.at(-2), holder.id.name, node, wait, give_up, stale);
		} else if (
			holder?.type === 'AssignmentExpression' &&
			holder.operator === '=' &&
			holder.right === node &&
			holder.left.type === 'Identifier' &&
			v.path.at(-2)?.type === 'ExpressionStatement'
		) {
			this.#check_after(v.path.at(-2), holder.left.name, node, wait, give_up, stale);
		} else
			report.fail(
				node,
				'$await(…) is a statement, the one initializer of a const or let, or the right of a plain assignment: the check after it needs a statement of its own.'
			);
		this.#c.walk_node(wait, v.scope);
		return true;
	}

	/** `<statement with $await(wait)>` → `<statement with await wait>` + `if (name === STALE) return`
	 *  (with what to give up with, as written). */
	#check_after(statement: N, name: string, call: N, wait: N, give_up: N, stale: string): void {
		const e = this.#c.emitter;
		const back = give_up === undefined ? '' : ` ${e.text(give_up)}`;
		e.rewrite(call, code`await ${wait}`);
		const semi = e.s.original[statement.end - 1] === ';' ? '' : ';';
		e.s.appendLeft(statement.end, `${semi} if (${name} === ${stale}) return${back};`);
		e.added += 2;
	}
}
