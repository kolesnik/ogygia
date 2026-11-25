/**
 * Defining a macro: the global names it owns, and the pass that expands them over one unit (the
 * compiler's per-file state, whatever it holds). A compiler is its macros, in order: its
 * vocabulary is their names, its walk their passes.
 *
 *   const hot = defineMacro({
 *     names: ['$hot'],
 *     pass: (unit: Unit) => ({
 *       call(node, v) {
 *         if (!isCall(node, '$hot')) return false
 *         unit.emitter.rewrite(node, code`${node.arguments[0]}`)
 *         v.next()
 *         return true
 *       },
 *     }),
 *   })
 *
 * A macro's typed signature is its declaration in the compiler's ambient `.d.ts`: the names a
 * macro defines are exactly the globals that file declares (a compiler's tests hold the two
 * equal).
 *
 * @packageDocumentation
 */
import type { Pass } from './pass.ts';
import type { Typed } from './types.ts';

/** A macro: the names it owns and its pass over a unit `U` (a walk carrying `S`). */
export interface Macro<U, S = unknown> extends Typed {
	/** The global names it owns, each starting with `$`. */
	readonly names: ReadonlyArray<string>;
	/** Its pass over one unit. */
	readonly pass: (unit: U) => Pass<S>;
}

/** Defines a macro. Every name it owns starts with `$`. */
export function defineMacro<U, S = unknown>(macro: Macro<U, S>): Macro<U, S> {
	for (const name of macro.names)
		if (!/^\$[A-Za-z][A-Za-z0-9]*$/.test(name))
			throw new Error(`defineMacro: "${name}" is not a $ name.`);
	return Object.freeze(macro);
}

/** The names a list of macros owns, in order, each once. */
export function namesOf<U, S>(macros: ReadonlyArray<Macro<U, S>>): Array<string> {
	return [...new Set(macros.flatMap((m) => m.names))];
}
