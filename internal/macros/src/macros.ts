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

/** `$dev()` and `$rules()` (./gate-pass.ts). */
const GATED = defineMacro<Compiler, Scope>({
	names: ['$dev', '$rules'],
	types: dedent`
		/** Marks the function this is the first statement of as development only: every call of it
		 *  compiles to \`DEV && name(…)\`. Compiles away. */
		function $dev(): void;
		/** Marks the function this is the first statement of as the rules tier (development, and
		 *  \`OGYGIA_RULES=1\` builds): every call of it compiles to \`RULES && name(…)\`. Compiles away. */
		function $rules(): void;
	`,
	pass: (c: Compiler) => new GatePass(c)
});

/** Every macro, in walk order. */
export const MACROS: ReadonlyArray<Macro<Compiler, Scope>> = [GATED];
