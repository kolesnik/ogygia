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
import { HotPass } from './hot-pass.ts';
import { MachinePass } from './machine-pass.ts';
import { OptionsPass } from './options-pass.ts';

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

/** `$hot(…)`, `$hot.allow(…)` and `$layout(…)` (./hot-pass.ts): checks; the definitions compile to
 *  their functions (./gate-pass.ts reads every marked definition). */
const HOT = defineMacro<Compiler, Scope>({
	names: ['$hot', '$layout'],
	types: dedent`
		/** Marks a function, where it is defined, as one on a per-event or per-turn path: the build
		 *  fails at anything in it that may allocate or force a layout. Compiles to the function. */
		const $hot: (<F extends (...args: never[]) => unknown>(fn: F) => F) & {
			/** An allocation made on purpose in a $hot function, by its name from the closed list
			 *  (internal/macros/src/hot.ts). Compiles to \`value\`. */
			allow<T>(exception: string, value: T): T;
		};
		/** Marks a function, where it is defined, as one that forces a layout: a $hot function that
		 *  calls it fails. Compiles to the function. */
		function $layout<F extends (...args: never[]) => unknown>(fn: F): F;
	`,
	pass: (c: Compiler) => new HotPass(c)
});

/** `$machine<S>()({ … })` (./machine-pass.ts). */
const MACHINE = defineMacro<Compiler, Scope>({
	names: ['$machine'],
	helpers: dedent`
		import type { Config, Kind, RunDef, Shape, Steps } from '@ogygia/machine';
	`,
	types: dedent`
		/** A machine definition, read and checked at build: as \`machine<S>()({ … })\` takes it,
		 *  for \`@ogygia/machine\`'s runtime (\`createRun(def)\`). A production build carries it
		 *  as data (\`compiledRunDef\`); dev and rules builds run \`runDef\` on it, with its checks. */
		function $machine<S extends Shape<S>>(): <const T extends Steps<S>, const I extends Kind<S>>(
			config: Config<S, T, I>
		) => RunDef<S, T, I>;
	`,
	pass: (c: Compiler) => new MachinePass(c)
});

/** The option bags of `@ogygia/machine`'s makers, checked at build (./options-pass.ts): no name of
 *  its own, the makers' calls are its. */
const OPTIONS = defineMacro<Compiler, Scope>({
	names: [],
	pass: (c: Compiler) => new OptionsPass(c)
});

/** Every macro, in walk order. */
export const MACROS: ReadonlyArray<Macro<Compiler, Scope>> = [GATED, AWAIT, HOT, MACHINE, OPTIONS];
