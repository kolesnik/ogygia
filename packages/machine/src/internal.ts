/**
 * ogygia's own packages only, never an app: the runtime its own code calls. A `Life` (the record
 * a public `Scope` is a view of) and a `Run` (a running machine) carry their operations as
 * methods, which make no handle and no closure that a method of the public API would. Their
 * behavior is the public methods' own; they may change in any release.
 *
 * @packageDocumentation
 */
import { Life, type EventOf, type ListenerTarget, type When, type Watcher } from './scope.ts';
import type { Run } from './run.ts';
import type { Fresh, Stale } from './stale.ts';
import type { DataArgs, Kind, Shape, StateIn, Steps } from './machine.ts';

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

/** @internal (until its callers call the method) `l.close()`. */
export function close(l: Life): void {
	l.close();
}
/** @internal (until its callers read the field) `l.closed`. */
export function closed(l: Life): boolean {
	return l.closed;
}
/** @internal (until its callers call the method) `l.child()`. */
export function child(l: Life): Life {
	return l.child();
}
/** @internal (until its callers call the method) `l.defer(cleanup)`. */
export function defer(l: Life, cleanup: () => void): void {
	l.defer(cleanup);
}
/** @internal (until its callers call the method) `l.on_close(fn, a, b, c)`. */
export function on_close<A, B, C>(
	l: Life,
	fn: (a: A, b: B, c: C) => void,
	a?: A,
	b?: B,
	c?: C
): void {
	l.on_close(fn, a, b, c);
}
/** @internal (until its callers call the method) `l.listen(...)`. */
export function listen<T extends ListenerTarget, K extends string>(
	l: Life,
	target: T,
	type: K,
	listener: (event: EventOf<T, K>) => void,
	options?: boolean | AddEventListenerOptions
): void {
	l.listen(target, type, listener, options);
}
/** @internal (until its callers call the method) `l.later(fn, when, a)`. */
export function later<A>(l: Life, fn: (a: A) => void, when: When, a?: A): void {
	l.later(fn, when, a);
}
/** @internal (until its callers call the method) `l.every(fn, ms)`. */
export function every(l: Life, fn: () => void, ms: number): () => void {
	return l.every(fn, ms);
}
/** @internal (until its callers call the method) `l.watch(observer)`. */
export function watch<O extends Watcher>(l: Life, observer: O): O {
	return l.watch(observer);
}
/** @internal (until its callers read the field) `l.signal`. */
export function signal(l: Life): AbortSignal {
	return l.signal;
}
/** @internal (until its callers call the method) `l.task(work)`. */
export function task<R>(
	l: Life,
	work: (signal: AbortSignal) => R
): Promise<Fresh<Awaited<R>> | Stale> {
	return l.task(work);
}
/** @internal (until its callers call the method) `m.visit()`. */
export function visit(m: Run): Life {
	return m.visit();
}
/** @internal (until its callers read the field) `m.epoch`. */
export function epoch(m: Run): number {
	return m.epoch;
}
/** @internal (until its callers read the field) `m.kind`. */
export function kind<S, T>(m: Run<S, T>): Run<S, T>['kind'] {
	return m.kind;
}
/** @internal (until its callers read the field) `m.now`. */
export function now<S, T>(m: Run<S, T>): Run<S, T>['now'] {
	return m.now;
}
/** @internal (until its callers read the field) `m.data`. */
export function data<S, T>(m: Run<S, T>): Run<S, T>['data'] {
	return m.data;
}
/** @internal (until its callers call the method) `m.stop()`. */
export function stop(m: Run): void {
	m.stop();
}
/** A machine with its types set aside, for the wrappers below. */
type Untyped = {
	go(to: string, data?: object): boolean;
	move(from: string, to: string, data?: object): boolean;
	is(name: string): boolean;
	wait(name: string): Promise<unknown>;
};
/** @internal (until its callers call the method) `m.go(to, data)`. */
export const go: <S extends Shape<S>, T extends Steps<S>, K extends T[Kind<S>][number]>(
	m: Run<S, T>,
	to: K,
	...data: DataArgs<S[K & keyof S]>
) => boolean = ((m: Untyped, to: string, data?: object) => m.go(to, data)) as never;
/** @internal (until its callers call the method) `m.move(from, to, data)`. */
export const move: <
	S extends Shape<S>,
	T extends Steps<S>,
	F extends Kind<S>,
	K extends T[F][number]
>(
	m: Run<S, T>,
	from: F,
	to: K,
	...data: DataArgs<S[K & keyof S]>
) => boolean = ((m: Untyped, from: string, to: string, data?: object) =>
	m.move(from, to, data)) as never;
/** @internal (until its callers call the method) `m.is(name)`. */
export const is: <S>(m: Run<S>, name: Kind<S>) => boolean = ((m: Untyped, name: string) =>
	m.is(name)) as never;
/** @internal (until its callers call the method) `m.wait(name)`. */
export const wait: <S, K extends Kind<S>>(m: Run<S>, name: K) => Promise<StateIn<S, K> | Stale> = ((
	m: Untyped,
	name: string
) => m.wait(name)) as never;
