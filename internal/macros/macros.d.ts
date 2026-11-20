// ogygia's build-time macros (internal/macros): written by `node internal/macros/src/types.ts`,
// held fresh by internal/macros/test/types.test.ts. Never hand-edited.

export {}

declare global {
  /** Marks a function, where it is defined, as development only:
   *  `const check: (n: number) => void = $dev(function check(n: number): void { … })`.
   *  Compiles to the function; every call of it compiles to `DEV && check(…)`. */
  function $dev<F extends (...args: never[]) => void>(fn: F): F;
  /** Marks a function, where it is defined, as the rules tier (development, and
   *  `OGYGIA_RULES=1` builds): every call of it compiles to `RULES && check(…)`. */
  function $rules<F extends (...args: never[]) => void>(fn: F): F;
}
