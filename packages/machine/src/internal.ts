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
export {
	check_flights,
	check_plain_flights,
	plain_flights,
	trusted_plain_flights
} from './flights.ts';
export { trusted_flights } from './flights-full.ts';
export { check_cache, trusted_cache } from './cache.ts';
export { lru, trusted_lru, type Lru, type LruOptions } from './lru.ts';
export {
	check_plain_queue,
	check_queue,
	pass_queue,
	plain_queue,
	trusted_pass_queue,
	trusted_plain_queue,
	trusted_queue
} from './queue.ts';
export { check_say, trusted_say } from './say.ts';
