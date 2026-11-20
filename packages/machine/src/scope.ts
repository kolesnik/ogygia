/**
 * One owner for everything a piece of work holds: its listeners, timers, observers, child work and
 * cleanups, released together, exactly once, when the owner ends.
 *
 *   const page = scope();
 *   page.on(window, 'popstate', on_pop);
 *   page.timeout(retry, 500);
 *   page.watch(new IntersectionObserver(on_seen)).observe(el);
 *   const html = await page.task((signal) => fetch(url, { signal }).then((r) => r.text()));
 *   if (html === STALE) return; // the page was left meanwhile
 *   ...
 *   page.close(); // every listener off, every timer cleared, the fetch aborted
 *
 * A scope is open until `close()`. Closing it closes its children first (newest first), then aborts
 * its `signal`, then lets go of what it holds (listeners, timers) and runs its cleanups, newest
 * first. Anything given to a scope that is already closed is released at once: a cleanup runs, an
 * observer disconnects, a disposable is disposed, and a listener or a timer is never set. So code
 * that runs late, after its owner ended, cannot leave anything behind.
 *
 * Each visit of a machine to a state is one (`m.scope`): leaving the state closes it.
 *
 * A `Scope` is a view of a `Life`, the plain record ogygia's own runtime works on through the free
 * functions below (`./internal.ts`), which hold a listener, a timer or a cleanup with no handle and
 * no closure at all. What a life holds is kept as flat entries, so holding one makes no closure of
 * its own; its children are a list, so one that closes leaves in constant time. The abort
 * controller and the entry lists are made the first time they are needed.
 */
import { machine_error, report } from './messages.ts';
import { noop } from './noop.ts';
import { tasks, timers, type TimerHandle } from './ports.ts';
import { STALE, whole, type Fresh, type Stale } from './stale.ts';

// (a runtime without the explicit-resource-management symbols gets the registered ones, as the
// TypeScript and esbuild `using` helpers do)
export const DISPOSE: typeof Symbol.dispose =
	Symbol.dispose ?? (Symbol.for('Symbol.dispose') as typeof Symbol.dispose);
const ASYNC_DISPOSE: typeof Symbol.asyncDispose =
	Symbol.asyncDispose ?? (Symbol.for('Symbol.asyncDispose') as typeof Symbol.asyncDispose);

/** Something with `addEventListener` / `removeEventListener`: a window, a document, an element, an
 *  AbortSignal, a worker, an EventSource. */
export interface ListenerTarget {
	addEventListener(type: string, listener: never, options?: never): void;
	removeEventListener(type: string, listener: never, options?: never): void;
}

/** Something with `on` / `off`: a Node EventEmitter (a child process, a socket, a request), Vite's
 *  `import.meta.hot`. */
export interface Emitter {
	on(type: string, listener: never): unknown;
	off(type: string, listener: never): unknown;
}

/** The event a target hands its `type` listener, read from its `on<type>` handler (a window's
 *  `click` is a MouseEvent); an `Event` when the target names none. */
export type EventOf<T, K extends string> = T extends { [P in `on${K}`]: infer H }
	? [H] extends [((event: infer E) => unknown) | null | undefined]
		? E
		: Event
	: Event;

/** When a `timeout` runs: after `ms`, at the next frame, or when the browser is idle. */
export type When = number | 'frame' | 'idle';

/** Anything that stops watching with `disconnect()`: a Mutation, Intersection, Resize or
 *  Performance observer. */
export interface Watcher {
	disconnect(): void;
}

export interface Scope {
	/** Aborts when the scope closes (already aborted on a closed scope). */
	readonly signal: AbortSignal;
	/** It has closed. */
	readonly closed: boolean;
	/**
	 * Listens to `type` on `target` until the scope closes (or the returned function is called). A
	 * DOM-style target or a Node-style emitter. On a closed scope it does not listen at all.
	 */
	on<T extends ListenerTarget, K extends string>(
		target: T,
		type: K,
		listener: (event: EventOf<T, K>) => void,
		options?: boolean | AddEventListenerOptions
	): () => void;
	on<A extends unknown[]>(
		target: Emitter,
		type: string,
		listener: (...args: A) => void
	): () => void;
	/**
	 * Runs `fn` once, after `when` (ms, `'frame'`, or `'idle'`), unless the scope closes first (or
	 * the returned function is called). Never keeps a server process alive: its owner does.
	 */
	timeout(fn: () => void, when: When): () => void;
	/** Runs `fn` every `ms` until the scope closes (or the returned function is called). */
	every(fn: () => void, ms: number): () => void;
	/** Disconnects `observer` when the scope closes (at once on a closed scope). Returns it. */
	watch<O extends Watcher>(observer: O): O;
	/**
	 * Runs `work` for this scope. Closing aborts `signal` and settles the task with `STALE` right
	 * then, even when `work` never finishes: an answer only lands while its scope is open. A failure
	 * after the scope closed is `STALE` too. A closed scope gives `STALE` without running `work`.
	 * Work that answers `STALE`, or an array with `STALE` in it (a `Promise.all` with a stale part),
	 * gives `STALE`: if anything it waited on is stale, the whole task is.
	 */
	task<R>(work: (signal: AbortSignal) => R): Promise<Fresh<Awaited<R>> | Stale>;
	/** A scope that closes when this one does, before this one's own cleanups. It can close sooner
	 *  on its own. A closed scope's child is closed. */
	child(): Scope;
	/**
	 * Runs `cleanup` once, when the scope closes; cleanups run newest first. One that throws does
	 * not stop the others: `close()` throws once all have run. On a closed scope it runs at once.
	 */
	defer(cleanup: () => void): void;
	/** Disposes `disposable` (`Symbol.dispose` or `Symbol.asyncDispose`) when the scope closes (at
	 *  once on a closed scope). Returns it. */
	adopt<D extends Disposable | AsyncDisposable>(disposable: D): D;
	/**
	 * Closes it: its children, then its signal, then what it holds and its cleanups (newest first).
	 * Safe to call twice. Throws what the cleanups (or the releases of what it holds) threw (an
	 * AggregateError for more than one), once all have run. An async disposal that fails is reported, as it has nobody to throw to: use
	 * `await using` (or `[Symbol.asyncDispose]()`) to wait for them and get their errors.
	 */
	close(): void;
	[Symbol.dispose](): void;
	[Symbol.asyncDispose](): Promise<void>;
}

/** The longest delay a timer holds (2^31 - 1 ms): Node and browsers run a longer one after 1 ms. */
export const MAX_TIMEOUT_MS = 2_147_483_647;

/** A delay a timer can hold. */
export function is_time(ms: unknown): ms is number {
	return typeof ms === 'number' && Number.isFinite(ms) && ms >= 0 && ms <= MAX_TIMEOUT_MS;
}

type Entries = unknown[];
type Release = (a: never, b: never, c: never) => void;

const DEAD = 0;
const EMITTED = 1;
const TIMER = 2;
const CALL = 3;
const WITH = 4;

// @why Node's EventTarget matches a capture listener on removal only by an options object, never a bare boolean (test: test/scope.test.ts › a capture listener given as an object is let go on close; so is a non-capture one with options)
const BUBBLE: EventListenerOptions = { capture: false };
const CAPTURE: EventListenerOptions = { capture: true };

/**
 * @internal What a scope is, as ogygia's own runtime holds it: plain fields and the methods its
 * runtime calls, which hold a listener, a timer or a cleanup with no handle and no closure. A
 * public `Scope` is one of these with the methods an app calls (`Scoped`); an app never holds a
 * bare one.
 *
 * - What it holds is flat entries of four. `_firsts`: listeners and timers, `[kind, a, b, c]` (a
 *   listener is its removal options, target, type and function; a timer is `TIMER` and its
 *   handle), let go in the order they came. `_cleanups`: a function alone, or a function and its
 *   three values followed by `WITH`, run newest first. Holding one makes no closure.
 * - Its children are a list through their `_prev`/`_next`, newest `_last`: one that closes leaves
 *   in constant time.
 * - `_epoch` is 0 or more while open and `-1 - epoch` once closed. A closed life stays closed: a
 *   machine's next visit is a life of its own, so code that kept a visit's life past the visit
 *   (across an `await`) only ever finds it closed.
 */
export class Life {
	/** The machine whose visit it is, or null: names it in what its close throws. */
	_label: string | null;
	_parent: Life | null;
	_prev: Life | null = null;
	_next: Life | null = null;
	_last: Life | null = null;
	_epoch = 0;
	/** Its close is running (a cleanup that adopts goes with the close's own disposals). */
	_closing = false;
	/** `await using` waits for its async disposals. */
	_awaited = false;
	_abort: AbortController | null = null;
	_firsts: Entries | null = null;
	_cleanups: Entries | null = null;
	/** Async disposals started by its close. */
	_settling: Promise<unknown>[] | null = null;

	/** A new life, its own root (`child()` makes one under a parent). */
	constructor(label: string | null = null, parent: Life | null = null) {
		this._parent = parent;
		this._label = label;
	}

	/** It has closed. */
	get closed(): boolean {
		return this._epoch < 0;
	}

	/** Aborts when it closes (already aborted on a closed life). */
	get signal(): AbortSignal {
		if (this._abort !== null) return this._abort.signal;
		const abort = (this._abort = new AbortController());
		if (this._epoch < 0) abort.abort();
		return abort.signal;
	}

	/** A life that closes when this one does, before this one's own cleanups; closed when this
	 *  one is. */
	child(): Life {
		return link(this, new Life(null, this));
	}

	/** Listens until it closes, as `Scope.on`, with no handle. */
	listen<T extends ListenerTarget, K extends string>(
		target: T,
		type: K,
		listener: (event: EventOf<T, K>) => void,
		options?: boolean | AddEventListenerOptions
	): void {
		hear(this, target, type, listener as (...args: never[]) => void, options);
	}

	/** Runs `fn(a)` once after `when`, unless it closes first, as `Scope.timeout`, with no handle.
	 *  Passing the one value `fn` needs as `a` makes no closure for it. */
	later<A>(fn: (a: A) => void, when: When, a?: A): void {
		arm(this, fn as (a?: A) => void, when, a);
	}

	/** `later`, with the function that cancels it sooner (see `Scope.timeout`). */
	timeout(fn: () => void, when: When): () => void {
		return early(this, arm(this, fn, when));
	}

	/** Runs `fn` every `ms` until it closes, with the function that stops sooner (see
	 *  `Scope.every`). */
	every(fn: () => void, ms: number): () => void {
		if (!is_time(ms)) throw machine_error('machine_bad_time', { where: 'every()', ms: String(ms) });
		return this._epoch < 0 ? noop : early(this, put(this, TIMER, timers.every(fn, ms), null, null));
	}

	/** Runs `cleanup` once when it closes, newest first; at once on a closed life. */
	defer(cleanup: () => void): void {
		if (this._epoch < 0) cleanup();
		else {
			const list = this._cleanups;
			if (list === null) this._cleanups = [cleanup];
			else list.push(cleanup);
		}
	}

	/** Runs `fn(a, b, c)` once when it closes, as `defer` does: passing the values `fn` needs
	 *  makes no closure for them. */
	on_close<A, B, C>(fn: (a: A, b: B, c: C) => void, a?: A, b?: B, c?: C): void {
		if (this._epoch < 0) fn(a as A, b as B, c as C);
		else put_cleanup(this, fn as Release, a, b, c);
	}

	/** Disconnects `observer` when it closes (at once on a closed life). Returns it. */
	watch<O extends Watcher>(observer: O): O {
		if (this._epoch < 0) observer.disconnect();
		else put_cleanup(this, disconnect, observer, null, null);
		return observer;
	}

	/** Disposes `disposable` when it closes (see `Scope.adopt`). Returns it. */
	adopt<D extends Disposable | AsyncDisposable>(disposable: D): D {
		const d = disposable as Partial<Disposable & AsyncDisposable>;
		const open = this._epoch >= 0;
		if (typeof d[DISPOSE] === 'function') {
			if (open) put_cleanup(this, dispose, d, null, null);
			else dispose(d as Disposable);
		} else if (typeof d[ASYNC_DISPOSE] === 'function') {
			if (open) put_cleanup(this, dispose_later, this, d, null);
			else if (this._closing) dispose_later(this, d as AsyncDisposable);
			// closed already (late work): its close has looked at its disposals, so this one is said
			// here. One adopted by a cleanup of its own close still goes with the close's own.
			else said(this, Promise.resolve((d as AsyncDisposable)[ASYNC_DISPOSE]()));
		} else throw machine_error('machine_not_disposable', { value: typeof disposable });
		return disposable;
	}

	/** Runs `work` for it (see `Scope.task`): `STALE` once it closes. */
	task<R>(work: (signal: AbortSignal) => R): Promise<Fresh<Awaited<R>> | Stale> {
		if (this._epoch < 0) return Promise.resolve(STALE);
		const sig = this.signal;
		let out: R | Promise<never>;
		try {
			out = work(sig);
		} catch (error) {
			out = Promise.reject(error);
		}
		// (work that closed its own scope before it returned, by moving its machine on: the abort
		// came before anyone could listen for it)
		if (sig.aborted) {
			Promise.resolve(out).then(noop, noop);
			return Promise.resolve(STALE);
		}
		return new Promise((resolve, reject) => {
			// settles the moment the scope closes, even when `work` ignores its signal and never does
			const on_abort = () => resolve(STALE);
			sig.addEventListener('abort', on_abort, { once: true });
			Promise.resolve(out).then(
				(value) => {
					sig.removeEventListener('abort', on_abort);
					resolve(sig.aborted ? STALE : whole(value as Awaited<R>));
				},
				(error: unknown) => {
					sig.removeEventListener('abort', on_abort);
					if (sig.aborted) resolve(STALE);
					else reject(error);
				}
			);
		});
	}

	/** Closes it (see `Scope.close`). Safe twice. */
	close(): void {
		const epoch = this._epoch;
		if (epoch < 0) return;
		this._epoch = -1 - epoch;
		this._closing = true;
		const parent = this._parent;
		if (parent !== null) {
			unlink(parent, this);
			this._parent = null;
		}
		let errors: unknown[] | null = null;
		for (let k = this._last; k !== null; k = this._last) {
			try {
				k.close();
			} catch (error) {
				(errors ??= []).push(error);
			}
			if (this._last === k) unlink(this, k);
		}
		this._abort?.abort();
		// (a release that throws, an `off` of a target that is gone, is one more error: the others
		// and the cleanups still run)
		const firsts = this._firsts;
		if (firsts !== null) {
			this._firsts = null;
			for (let i = 0; i < firsts.length; i += 4) {
				const k = firsts[i];
				if (k === DEAD) continue;
				try {
					free(k, firsts[i + 1], firsts[i + 2], firsts[i + 3]);
				} catch (error) {
					(errors ??= []).push(error);
				}
			}
		}
		const cleanups = this._cleanups;
		if (cleanups !== null) {
			this._cleanups = null;
			for (let i = cleanups.length - 1; i >= 0; i--) {
				const top = cleanups[i];
				try {
					if (top !== WITH) (top as () => void)();
					else {
						i -= 4;
						(cleanups[i] as (a: unknown, b: unknown, c: unknown) => void)(
							cleanups[i + 1],
							cleanups[i + 2],
							cleanups[i + 3]
						);
					}
				} catch (error) {
					(errors ??= []).push(error);
				}
			}
		}
		this._closing = false;
		if (this._settling !== null && !this._awaited)
			for (const done of this._settling) said(this, done);
		if (errors !== null)
			throw errors.length === 1
				? errors[0]
				: new AggregateError(errors, `[ogygia] ${named(this)}: ${errors.length} cleanups threw`);
	}
}

function named(l: Life): string {
	return l._label === null ? 'scope' : `machine ${l._label}`;
}

function free(k: unknown, a: unknown, b: unknown, c: unknown): void {
	if (k === TIMER) timers.cancel(a as TimerHandle);
	else if (k === CALL) (a as () => void)();
	else if (k === EMITTED) (a as Emitter).off(b as string, c as never);
	else (a as EventTarget).removeEventListener(b as string, c as EventListener, k as object);
}

function disconnect(observer: Watcher): void {
	observer.disconnect();
}

function dispose(d: Disposable): void {
	d[DISPOSE].call(d);
}

function dispose_later(l: Life, d: AsyncDisposable): void {
	(l._settling ??= []).push(Promise.resolve(d[ASYNC_DISPOSE].call(d)));
}

function said(l: Life, done: Promise<unknown>): void {
	done.then(undefined, (error: unknown) =>
		report('machine_dispose_failed', { owner: named(l) }, error)
	);
}

function put(l: Life, k: unknown, a: unknown, b: unknown, c: unknown): number {
	const list = (l._firsts ??= []);
	return list.push(k, a, b, c) - 4;
}

function put_cleanup(l: Life, fn: Release, a: unknown, b: unknown, c: unknown): void {
	const list = l._cleanups;
	if (list === null) l._cleanups = [fn, a, b, c, WITH];
	else list.push(fn, a, b, c, WITH);
}

function drop(list: Entries, i: number): void {
	list[i] = DEAD;
	list[i + 1] = list[i + 2] = list[i + 3] = null;
	let n = list.length;
	while (n !== 0 && list[n - 4] === DEAD) n -= 4;
	list.length = n;
}

function unlink(parent: Life, k: Life): void {
	const prev = k._prev;
	const next = k._next;
	if (prev !== null) prev._next = next;
	if (next !== null) next._prev = prev;
	else if (parent._last === k) parent._last = prev;
	k._prev = k._next = null;
}

function link<L extends Life>(l: Life, k: L): L {
	if (l._epoch < 0) {
		k._parent = null;
		k._epoch = -1;
		return k;
	}
	const last = l._last;
	k._prev = last;
	if (last !== null) last._next = k;
	l._last = k;
	return k;
}

function early(l: Life, i: number): () => void {
	if (i < 0) return noop;
	const list = l._firsts as Entries;
	const a = list[i + 1];
	const c = list[i + 3];
	return () => {
		const now = l._firsts;
		const at = i;
		i = -1;
		if (at >= 0 && now !== null && now[at + 1] === a && now[at + 3] === c) {
			const k = now[at];
			const b = now[at + 2];
			drop(now, at);
			free(k, a, b, c);
		}
	};
}

function hear(
	l: Life,
	target: ListenerTarget | Emitter,
	type: string,
	listener: (...args: never[]) => void,
	options: boolean | AddEventListenerOptions | undefined
): number {
	if (l._epoch < 0) return -1;
	if ('addEventListener' in target) {
		const t = target as unknown as EventTarget;
		const heard = listener as unknown as EventListener;
		let i = -1;
		const fn: EventListener =
			typeof options === 'object' && options.once === true
				? function once(this: EventTarget, event) {
						const list = l._firsts;
						if (list !== null && list[i + 3] === once) drop(list, i);
						heard.call(this, event);
					}
				: heard;
		t.addEventListener(type, fn, options);
		const capture = typeof options === 'boolean' ? options : options?.capture === true;
		return (i = put(l, capture ? CAPTURE : BUBBLE, t, type, fn));
	}
	(target as Emitter).on(type, listener as never);
	return put(l, EMITTED, target, type, listener);
}

function arm<A>(l: Life, fn: (a?: A) => void, when: When, a?: A): number {
	if (when !== 'frame' && when !== 'idle' && !is_time(when))
		throw machine_error('machine_bad_time', { where: 'timeout()', ms: String(when) });
	if (l._epoch < 0) return -1;
	let i = -1;
	const fire = () => {
		const now = l._firsts;
		if (now !== null && now[i + 1] === held) drop(now, i);
		if (a === undefined) fn();
		else fn(a);
	};
	// @why no frames or idle time on a server or in a worker: the ports fall back to the next task (test: test/scope.test.ts › 'frame' and 'idle' run once (a frame, idle time, or the next task where there is none))
	const timed = when !== 'frame' && when !== 'idle';
	const held = timed
		? timers.after(fire, when)
		: (when === 'frame' ? tasks.frame : tasks.idle)(fire);
	return (i = put(l, timed ? TIMER : CALL, held, null, null));
}

/** @internal A new life, its own root (as `new Life(label)`). */
export function root(label: string | null = null): Life {
	return new Life(label);
}

/** @internal What `l` still holds: live listeners, timers and cleanups, and open children. */
export function held(l: Life): number {
	if (l._epoch < 0) return 0;
	let n = 0;
	for (let k = l._last; k !== null; k = k._prev) n++;
	const firsts = l._firsts;
	if (firsts !== null) for (let i = 0; i < firsts.length; i += 4) if (firsts[i] !== DEAD) n++;
	const cleanups = l._cleanups;
	if (cleanups !== null)
		for (let i = cleanups.length - 1; i >= 0; i--) {
			if (cleanups[i] === WITH) i -= 4;
			n++;
		}
	return n;
}

/** @internal A life closed for good: what a stale view, or the scope of an owner that ended,
 *  works on. */
export const ENDED: Life = /* @__PURE__ */ ended();

function ended(): Life {
	const l = new Life();
	l._epoch = -1;
	return l;
}

/**
 * The public `Scope`: a life with the methods an app calls beyond its own, so a scope is its own
 * life and the runtime's methods work on it as it is.
 */
class Scoped extends Life implements Scope {
	on(
		target: ListenerTarget | Emitter,
		type: string,
		listener: (...args: never[]) => void,
		options?: boolean | AddEventListenerOptions
	): () => void {
		return early(this, hear(this, target, type, listener, options));
	}

	child(): Scoped {
		return this._epoch < 0 ? CLOSED_SCOPE : link(this, new Scoped(null, this));
	}

	[DISPOSE](): void {
		this.close();
	}

	async [ASYNC_DISPOSE](): Promise<void> {
		const errors: unknown[] = [];
		if (this._epoch >= 0) {
			this._awaited = true;
			try {
				this.close();
			} catch (error) {
				errors.push(error);
			}
		}
		for (const done of await Promise.allSettled(this._settling ?? []))
			if (done.status === 'rejected' && this._awaited) errors.push(done.reason);
		if (errors.length === 1) throw errors[0];
		if (errors.length > 1)
			throw new AggregateError(errors, `[ogygia] ${named(this)}: ${errors.length} cleanups threw`);
	}
}

/** @internal What a public scope is made as: a life that is a `Scope` (a machine's visits, `scope()`). */
export const SCOPED: new (label?: string | null, parent?: Life | null) => Life = Scoped;

/** The scope of an owner that has already ended: everything given to it is released at once. */
export const CLOSED: Scope = /* @__PURE__ */ closed_scope();

const CLOSED_SCOPE = CLOSED as Scoped;

function closed_scope(): Scoped {
	const s = new Scoped();
	s._epoch = -1;
	return s;
}

/** @internal The life of an owner: a public scope is its own life. */
export function life_of(s: Scope | Life): Life {
	return s as Life;
}

/** A new scope; with `parent`, one that closes when the parent does (`parent.child()`). */
export function scope(parent?: Scope): Scope {
	return parent === undefined ? new Scoped() : parent.child();
}
