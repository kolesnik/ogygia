/**
 * ogygia's macros, in walk order: at each node the first macro whose pass takes it owns it.
 *
 * @packageDocumentation
 */
import { defineMacro, type Macro } from 'ogygia-internal-compilerkit';
import type { Scope } from 'periscopic';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import type { Compiler } from './compiler.ts';
import { GatePass } from './gate-pass.ts';

/** `$dev(…)` and `$rules(…)` (./gate-pass.ts). */
const GATED = defineMacro<Compiler, Scope>({
	names: ['$dev', '$rules'],
	types: dedent`
		/** Marks a function, where it is defined, as development only:
		 *  \`const check: (n: number) => void = $dev(function check(n: number): void { … })\`.
		 *  Compiles to the function; every call of it compiles to
		 *  \`import.meta.env.DEV && check(…)\`. */
		function $dev<F extends (...args: never[]) => void>(fn: F): F;
		/** Marks a function, where it is defined, as the rules tier (development, and
		 *  \`OGYGIA_RULES=1\` builds): every call of it compiles to \`RULES && check(…)\`. */
		function $rules<F extends (...args: never[]) => void>(fn: F): F;
	`,
	pass: (c: Compiler) => new GatePass(c)
});

/** Every macro, in walk order. */
export const MACROS: ReadonlyArray<Macro<Compiler, Scope>> = [GATED];
