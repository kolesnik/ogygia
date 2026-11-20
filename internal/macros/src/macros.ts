/**
 * ogygia's macros, in walk order: at each node the first macro whose pass takes it owns it.
 *
 * @packageDocumentation
 */
import { defineMacro, type Macro } from 'ogygia-internal-compilerkit';
import type { Scope } from 'periscopic';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import type { Compiler } from './compiler.ts';
import { AwaitPass } from './await-pass.ts';
import { GatePass } from './gate-pass.ts';
import { MachinePass } from './machine-pass.ts';

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

/** `$await(…)` (./await-pass.ts). */
const AWAIT = defineMacro<Compiler, Scope>({
	names: ['$await'],
	helpers: "import type { Stale } from '@ogygia/machine';",
	types: dedent`
		/** Awaits a wait that may settle \`STALE\` (a \`task\`, a \`wait\`, an \`ask\`) and gives up
		 *  when it does: \`$await(w)\` is \`if ((await w) === STALE) return\`, and \`const v = $await(w)\`
		 *  is \`const v = await w; if (v === STALE) return\`. \`give_up\` is what the function returns
		 *  then (evaluated only then). Only as a statement, a const's or let's one initializer, or the
		 *  right of a plain assignment, in an async function. */
		function $await<T>(wait: PromiseLike<T>, give_up?: unknown): Exclude<T, Stale>;
	`,
	pass: (c: Compiler) => new AwaitPass(c)
});

/** `$machine<S>()({ … })` (./machine-pass.ts). */
const MACHINE = defineMacro<Compiler, Scope>({
	names: ['$machine'],
	helpers: dedent`
		import type { Config, Kind, Shape, Steps } from '@ogygia/machine';
		import type { Def } from '@ogygia/machine/internal';
	`,
	types: dedent`
		/** A machine definition, read and checked at build: as \`machine<S>()({ … })\` takes it,
		 *  for the runtime of \`@ogygia/machine/internal\` (\`create(def)\`). A production build
		 *  carries it as data; dev and rules builds run \`define\` on it, with its checks. */
		function $machine<S extends Shape<S>>(): <const T extends Steps<S>, const I extends Kind<S>>(
			config: Config<S, T, I>
		) => Def<S, T, I>;
	`,
	pass: (c: Compiler) => new MachinePass(c)
});

/** Every macro, in walk order. */
export const MACROS: ReadonlyArray<Macro<Compiler, Scope>> = [GATED, AWAIT, MACHINE];
