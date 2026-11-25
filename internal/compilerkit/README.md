# compilerkit

Vendored from the DnD project's `packages/compilerkit` (at `f7b31eaf`) for ogygia's own build:
private, never published, and kept in its original camelCase so a diff against the source stays
readable. Left out: `views.ts`, `records.ts` and `layout.ts` (the DnD trait registry's numbered
layouts).

The base of a build-time macro compiler for TypeScript. A compiler built on it is a list of
macros. Each macro owns some global `$` names, has a pass that expands them, and has a typed
signature. The kit walks every pass over one parse of a file, keeps every edit, and fails the
build at the exact file, line and column when a rule is broken.

It knows nothing about what its macros mean. State machines, scopes and structs are macros
written on top of it, not built in.

## What it gives you

| Piece                                                                            | What it does                                                                                                                                                     |
| -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `defineMacro({ names, pass, types })`                                            | A macro: its global names, its pass over one file, its declaration source.                                                                                       |
| `vocabulary(names, reserved)`                                                    | The names a compiler owns: a fast text test, the names a parse really uses, and refused names.                                                                   |
| `walkPasses(program, state, passes, at)`                                         | One walk; at each call, member, type reference and statement the first pass that takes it owns it.                                                               |
| `Emitter`                                                                        | Edits on the original text. `rewrite(node, code\`…\`)`writes a template around kept nodes.`name('go')`imports the runtime once and reads`$.go`, statically only. |
| `Report`, `MacroError`                                                           | `file:line:column  message`. The first error stops the build.                                                                                                    |
| `parse`, `runtimeOf`, `Mode`                                                     | One parse per file; `dev`, `prod`, or `reference` (the macros read plainly, on a reference implementation a test compares against).                              |
| `step`, `pipeline`                                                               | A code generator as named steps with typed input and output: `collect → layout → generate`.                                                                      |
| `writeGenerated`                                                                 | Committed generated modules: written, or checked fresh (a stale or extra file is reported).                                                                      |
| `shortNames`, `shorten`                                                          | The last step, build output only: internal member names (default: ending in `$`) become short.                                                                   |
| `declarations`, `dts`                                                            | The ambient `.d.ts` source files type-check against, generated from the macros' signatures.                                                                      |
| `publishedTypes`                                                                 | Checks a published `.d.ts`: no shortened name and no macro reaches an app.                                                                                       |
| `macroPlugin`                                                                    | The Vite / rolldown / tsdown plugin: compiles each source first, emits what the compiles gathered.                                                               |
| `Gate`, `gated`, `importedGate`, `hoistedGate`, `expressionGate`, `NODE_ENV_DEV` | Named gates (`dev`, a rules tier…): the condition a call is put behind, imported, hoisted or written in place once per file.                                     |
| `Tracker.scopeAlong`, `.annotated`                                               | The scope where a walk's path ends; the annotated declaration of a name there.                                                                                   |
| `Tracker.fixed`, `.untracked`                                                    | A value bound once and never written after; a tracked argument a local function's parameter loses.                                                               |
| `compilerkit/marks`: `markOf`, `markedDefinition`                                | Marks at the definition: `const name = $mark(function name(…) { … })`, and how well it keeps that shape.                                                         |
| `compilerkit/marks`: `namedIn`, `firstMisuse`                                    | A name from a closed list of exceptions; a name that may only be called as a statement, used otherwise.                                                          |
| `compilerkit/modules`: `sourceOf`, `fileCache`, `relativeImports`                | Other modules: a file by its import path, a reading made again only when its text changes, relative imports.                                                     |
| `compilerkit/reach`: `pathTo`, `functionsOf`, `CallGraph`                        | Named functions across modules with their marks, calls and notes; the shortest call path from a marked root to what it may not reach.                            |
| `compilerkit/alloc`: `allocations`, `pureCall`                                   | Every place a function may allocate; the calls the language promises make nothing (`Math.*`, a `Map`'s `get`).                                                   |
| `compilerkit/comptime`: `evaluate`, `constantsOf`, `evaluateIn`                  | Code run at build, its result shipped as data; it may read constants of its module and those it imports.                                                         |
| `compilerkit/messages`: `readMessages`, `argumentsOf`, `wordsOf`, `idProblems`   | Message tables: fixed ids against a committed baseline, safe arguments only in production, words only in development.                                            |
| `compilerkit/testing`: `check`, `output`                                         | `check(() => compile(bad)).fails('x.ts:2:11  …')`, and an input's output for a snapshot.                                                                         |

## A compiler in a few lines

```ts
import {
  Emitter,
  Report,
  code,
  defineMacro,
  isCall,
  namesOf,
  parse,
  vocabulary,
  walkPasses,
} from 'compilerkit'

const twice = defineMacro({
  names: ['$twice'],
  types: 'function $twice(value: number): number',
  pass: (unit: { emitter: Emitter; report: Report }) => ({
    call(node, v) {
      if (!isCall(node, '$twice')) return false
      unit.emitter.rewrite(node, code`(${node.arguments[0]}) * 2`)
      v.next()
      return true
    },
  }),
})

const words = vocabulary(namesOf([twice]))

export function compile(source: string, file: string) {
  if (!words.mayUse(source)) return null
  const report = new Report(source, file)
  const program = parse(source, report)
  const emitter = new Emitter(source, report, new Set())
  walkPasses(program, null, [twice.pass({ emitter, report })], () => null)
  return { code: emitter.finish('my-runtime', program) }
}
```

## Rules it keeps

- Only build output may be unreadable. Generated modules and declarations that are committed stay
  readable and are checked fresh.
- A broken rule fails the build at its place. There is no silent fallback.
- The runtime is read through one namespace import, by static member only, so a bundler can drop
  what a file does not call.

## Tests

`pnpm --filter compilerkit test` runs them. `pnpm --filter compilerkit test:types` type-checks.
