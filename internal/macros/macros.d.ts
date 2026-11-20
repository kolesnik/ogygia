// ogygia's build-time macros (internal/macros): written by `node internal/macros/src/types.ts`,
// held fresh by internal/macros/test/types.test.ts. Never hand-edited.

export {}

declare global {
  /** Marks the function this is the first statement of as development only: every call of it
   *  compiles to `DEV && name(…)`. Compiles away. */
  function $dev(): void;
  /** Marks the function this is the first statement of as the rules tier (development, and
   *  `OGYGIA_RULES=1` builds): every call of it compiles to `RULES && name(…)`. Compiles away. */
  function $rules(): void;
}
