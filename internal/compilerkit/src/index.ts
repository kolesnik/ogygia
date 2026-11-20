/**
 * compilerkit: the base of a build-time macro compiler. A compiler built on it is its macros (each
 * the global names it owns, a pass that expands them, and its typed signature), walked over one
 * parse of a file; an emitter that keeps every edit and imports the runtime by static `$.name`
 * reads; build errors that name the file and line; named steps with typed input and output for
 * the compilers that generate code; committed generated modules and declarations checked fresh;
 * a final shortening step for build output only; and the plugin for Vite, rolldown and tsdown.
 *
 * Nothing here knows what its macros mean: a compiler's own concepts are its macros.
 *
 * @packageDocumentation
 */
export {
	bareSpot,
	countStatements,
	declaredRef,
	isCall,
	keyName,
	macroName,
	member,
	refName,
	typeName,
	type N
} from './ast.ts';
export { MacroError, Report } from './report.ts';
export { DEV_CHECK, devOnly } from './dev.ts';
export { Emitter, code, type Part } from './emitter.ts';
export { hookOf, walkPasses, type Pass, type Visit } from './pass.ts';
export { defineMacro, namesOf, type Macro } from './macro.ts';
export { refuseReserved, vocabulary, type Vocabulary } from './vocabulary.ts';
export { parse, runtimeOf, type Mode, type Runtimes } from './unit.ts';
export { Tracker, type Binding, type Classifier, type Where } from './tracker.ts';
export { pipeline, step, type Step } from './pipeline.ts';
export { writeGenerated, type Module, type WriteOptions } from './generated.ts';
export { resolveSpecifier } from './specifier.ts';
export { crossings, endsInDollar, shortNames, shorten, type Shortened } from './shorten.ts';
export { declarations, dts, publishedTypes, type PublishedRules, type Typed } from './types.ts';
export { ambientTypes, emitDeclarations, type AmbientOptions } from './ambient.ts';
export { macroPlugin, notSource, type Compiled, type PluginOptions } from './plugin.ts';
