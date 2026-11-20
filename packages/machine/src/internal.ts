/**
 * ogygia's own packages only, never an app: the free functions its runtime calls on a `Life`, the
 * record a public `Scope` is a view of. They make no handle and no closure that a method of the
 * public API would. Their behavior is the public methods' own; they may change in any release.
 *
 * @packageDocumentation
 */
export {
	adopt,
	child,
	close,
	closed,
	defer,
	ENDED,
	every,
	hear_until,
	held,
	later,
	root,
	life_of,
	listen,
	on_close,
	signal,
	task,
	timeout,
	watch,
	type Life
} from './scope.ts';
export { visit } from './run.ts';
export {
	create,
	data,
	definition,
	epoch,
	go,
	is,
	kind,
	move,
	now,
	stop,
	wait,
	type Def,
	type Run,
	type RunOf
} from './run.ts';
export { graph, paths } from './machine.ts';
