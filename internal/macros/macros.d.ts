// ogygia's build-time macros (internal/macros): written by `node internal/macros/src/types.ts`,
// held fresh by internal/macros/test/types.test.ts. Never hand-edited.

export {}

import type { Stale } from '@ogygia/machine';

import type { Config, Kind, Shape, Steps } from '@ogygia/machine';
import type { Def } from '@ogygia/machine/internal';

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

  /** A machine definition, read and checked at build: as `machine<S>()({ … })` takes it,
   *  for the runtime of `@ogygia/machine/internal` (`create(def)`). A production build
   *  carries it as data; dev and rules builds run `define` on it, with its checks. */
  function $machine<S extends Shape<S>>(): <const T extends Steps<S>, const I extends Kind<S>>(
  	config: Config<S, T, I>
  ) => Def<S, T, I>;
}
