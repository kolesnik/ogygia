/**
 * One flight of shared async work, as `flights()` runs it: its shared answer, who
 * still waits on it, how soon they need it, and its tries under a retry policy.
 */
import { bad_option, report_thrown } from './messages.ts';
import { under_policy, type Policy } from './policy.ts';
import { STALE, type Stale } from './stale.ts';

/** The flight a run serves: how soon its callers need it. */
export interface InFlight {
	/** The highest priority of the callers that joined it so far. It never goes down. */
	readonly priority: number;
	/** `raised` is called with the new priority each time a caller raises it, while this try is out
	 *  (under a `retry` policy, the next try starts with no listeners). */
	onRaise(raised: (priority: number) => void): void;
}

export interface GetOptions {
	/** This caller leaves when it aborts: it gets `STALE` at once, and the work is aborted once
	 *  every caller of its flight has left. */
	signal?: AbortSignal;
	/** Start a new flight even when an answer is kept (a revalidation): the kept answer stays until
	 *  the new one lands. A flight already out for the key is ended (its callers get `STALE`). */
	fresh?: boolean;
	/** How soon this caller needs it: higher is sooner. Default 0. A flight out at a lower one is
	 *  raised to it (its run hears it); one at a higher one stays as it is. */
	priority?: number;
}

/** What a key holds now: a flight with nothing kept yet, or a kept answer (`flying`: a fresh flight
 *  for it is out). `at` is when the answer landed, on the wall clock (`clock.wall()`). */
export type FlightEntry<V> =
	| { readonly kind: 'flying' }
	| { readonly kind: 'kept'; readonly answer: V; readonly at: number; readonly flying: boolean };

/** `get`'s arguments: no input for a flights of one key (`flights({ run: () => … })`). */
export type GetArgs<I> = [I] extends [void]
	? [input?: undefined, options?: GetOptions]
	: [input: I, options?: GetOptions];

export const STALE_NOW: Promise<Stale> = Promise.resolve(STALE);
export const FLYING: FlightEntry<never> = Object.freeze({ kind: 'flying' });

/** One flight: its shared answer, who still waits on it, and how soon they need it (it is the
 *  `InFlight` its run is handed). */
export class Flight implements InFlight {
	shared: Promise<unknown>;
	/** Callers with a signal still waiting. */
	holders = 0;
	/** A caller with no signal joined: it holds the flight until it lands. */
	pinned = false;
	/** The world when it started (`world.stamp()`): its answer is judged against it. */
	stamp: number;
	priority: number;
	/** What the run hears a raise with (`null`: nothing yet, the common case). */
	_raised: ((priority: number) => void)[] | null = null;
	/** The flights' name, for a listener's failure. */
	_name: string;

	constructor(shared: Promise<unknown>, stamp: number, priority: number, name: string) {
		this.shared = shared;
		this.stamp = stamp;
		this.priority = priority;
		this._name = name;
	}

	onRaise(raised: (priority: number) => void): void {
		if (typeof raised !== 'function') throw bad_option('onRaise', typeof raised, 'a function');
		(this._raised ??= []).push(raised);
	}

	/** A caller at `priority` joined: a higher one raises it, and every listener hears it. */
	_raise(priority: number): void {
		if (priority <= this.priority) return;
		this.priority = priority;
		const heard = this._raised;
		if (heard === null) return;
		for (const raised of heard) {
			try {
				raised(priority);
			} catch (error) {
				// (the joining caller is not the one to fail: the listener is the run's)
				report_thrown('machine_flight_raise_failed', { name: this._name }, error);
			}
		}
	}
}

/** A caller's priority: 0 when it gave none; refused when it is not a number. */
export function priority_of(options: GetOptions | undefined): number {
	const priority = options?.priority;
	if (priority === undefined) return 0;
	if (typeof priority !== 'number' || priority !== priority)
		throw bad_option('priority', priority, 'a number (higher is sooner)');
	return priority;
}

/** One try with no deadline needs no policy: the run is the flight's work as it is. */
export function retry_of(retry: Policy | null | undefined): Policy | null {
	if (retry == null) return null;
	return retry.attempts <= 1 && retry.deadline === Infinity ? null : retry;
}

/** A `retry` is none, or a policy from `policy()`: `machine_bad_option` else. */
export function check_retry(retry: Policy | null | undefined): void {
	if (retry != null && !(typeof retry === 'object' && Number.isInteger(retry.attempts)))
		throw bad_option('retry', typeof retry, 'a policy from policy()');
}

/** How long an answer stays is a number of ms (0 or more), or a function that makes one:
 *  `machine_bad_option` else. */
export function check_keep(keep: unknown): void {
	if (keep !== undefined && typeof keep !== 'function' && !(typeof keep === 'number' && keep >= 0))
		throw bad_option('keep', keep, 'a time in ms of 0 or more, or a function that makes one');
}

/** One flight's work: one run, or the runs its policy gives (`STALE` once the flight is left). */
export function attempt<I, V>(
	run: (input: I, signal: AbortSignal, flight: InFlight) => V,
	input: I,
	signal: AbortSignal,
	flight: Flight,
	retry: Policy | null
): V | Promise<Awaited<V> | Stale> {
	if (retry === null) return run(input, signal, flight);
	return under_policy(
		retry,
		(s) => {
			// (a new try: the listeners of the one before were its, and it is over)
			flight._raised = null;
			return run(input, s, flight);
		},
		signal
	);
}

/** A caller joins `flight`: with no signal, the shared answer; with one, its own stake in it, and
 *  `abandoned` runs once the last caller with a signal has left a flight nobody pinned. */
export function join<V>(
	flight: Flight,
	signal: AbortSignal | undefined,
	abandoned: () => void
): Promise<V> {
	const shared = flight.shared as Promise<V>;
	if (signal === undefined) {
		flight.pinned = true;
		return shared;
	}
	flight.holders++;
	return new Promise((resolve, reject) => {
		const leave = () => {
			resolve(STALE as V);
			// the last caller left: nobody wants the answer, so the work stops
			if (--flight.holders > 0 || flight.pinned) return;
			abandoned();
		};
		signal.addEventListener('abort', leave, { once: true });
		shared.then(
			(answer) => {
				signal.removeEventListener('abort', leave);
				resolve(answer);
			},
			(error: unknown) => {
				signal.removeEventListener('abort', leave);
				reject(error);
			}
		);
	});
}
