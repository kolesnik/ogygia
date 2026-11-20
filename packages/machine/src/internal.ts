/**
 * ogygia's own packages only, never an app: the runtime its own code calls. A `Life` (the record
 * a public `Scope` is a view of) and a `Run` (a running machine) carry their operations as
 * methods, which make no handle and no closure that a method of the public API would. Their
 * behavior is the public methods' own; they may change in any release.
 *
 * @packageDocumentation
 */
export { DISPOSE, ENDED, held, Life, life_of, root } from './scope.ts';
export {
	compiled,
	create,
	define,
	definition,
	Run,
	type CompiledTimeout,
	type Def,
	type RunOf
} from './run.ts';
export { graph, paths } from './machine.ts';
export { lru, type Lru, type LruOptions } from './lru.ts';
