// ogygia's build-time macros (internal/macros): written by `node internal/macros/src/types.ts`,
// held fresh by internal/macros/test/types.test.ts. Never hand-edited.

export {}

import type { Stale } from '@ogygia/machine';

declare global {
  /** Marks a function, where it is defined, as development only:
   *  `const check: (n: number) => void = $dev(function check(n: number): void { … })`.
   *  Compiles to the function; every call of it compiles to
   *  `import.meta.env.DEV && check(…)`. */
  function $dev<F extends (...args: never[]) => void>(fn: F): F;
  /** Marks a function, where it is defined, as the rules tier (development, and
   *  `OGYGIA_RULES=1` builds): every call of it compiles to `RULES && check(…)`. */
  function $rules<F extends (...args: never[]) => void>(fn: F): F;

  /** Awaits a wait that may settle `STALE` (a `task`, a `wait`, an `ask`) and gives up
   *  when it does: `$await(w)` is `if ((await w) === STALE) return`, and `const v = $await(w)`
   *  is `const v = await w; if (v === STALE) return`. `give_up` is what the function returns
   *  then (evaluated only then). Only as a statement, a const's or let's one initializer, or the
   *  right of a plain assignment, in an async function. */
  function $await<T>(wait: PromiseLike<T>, give_up?: unknown): Exclude<T, Stale>;

  /** Marks a function, where it is defined, as one on a per-event or per-turn path: the build
   *  fails at anything in it that may allocate or force a layout. Compiles to the function. */
  const $hot: (<F extends (...args: never[]) => unknown>(fn: F) => F) & {
  	/** An allocation made on purpose in a $hot function, by its name from the closed list
  	 *  (internal/macros/src/hot.ts). Compiles to `value`. */
  	allow<T>(exception: string, value: T): T;
  };
  /** Marks a function, where it is defined, as one that forces a layout: a $hot function that
   *  calls it fails. Compiles to the function. */
  function $layout<F extends (...args: never[]) => unknown>(fn: F): F;
}
