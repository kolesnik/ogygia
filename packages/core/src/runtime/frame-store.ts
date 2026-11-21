import {
	cache,
	STALE,
	world,
	type Cache,
	type Flights,
	type InFlight,
	type Stale,
	type World
} from '@ogygia/machine';
import { plainFlights } from '@ogygia/machine';
import * as life from '@ogygia/machine';
import * as fsm from '@ogygia/machine';
import type { Life } from '@ogygia/machine';
import { older_by, stands_at, type DropWhy, type Frame } from '../frame.ts';
import type { VerifiedHtml } from './html-sink.ts';
import { watch, notify, watcher_count } from '../ref-watch.ts';

/** The store's fetch at an address. `flight` is the address's flight: its priority is the most
 *  urgent caller's, raised as callers join (a queued download follows it: load-scheduler.ts). */
export type FrameFetcher = (signal: AbortSignal, flight: InFlight) => Promise<VerifiedHtml>;

/** A frame as the store holds it: its HTML vouched for (./html-sink.ts), as everything the store
 *  hands on goes into a region's DOM. */
export type StoredFrame = Frame & { html: VerifiedHtml };

const frame_id = (a: string): string => `frame:${a}`;

const REFUSED = 'RegionAnswerRefused';

const is_refusal = (err: unknown): err is Error =>
	(err as { name?: string } | null)?.name === REFUSED;

/** A refused answer no caller heard yet (the page's early start: ./early-holes.ts), held at its
 *  address for the first caller that asks there (see `Entry.refused`). Any other failure is not. */
export function hold_refusal(a: string, err: unknown): void {
	if (is_refusal(err)) entry(a).refused = err;
}

type FrameAsk = { a: string; work: FrameFetcher | Promise<VerifiedHtml | Stale> };

type Shown = { v: number; d: number | undefined; html: VerifiedHtml };

type AnswerStates = {
	empty: {};
	shown: Shown;
	kept: Shown & { dropped: { v: number; d: number | undefined; why: DropWhy } };
};

const answer_definition = () =>
	$machine<AnswerStates>()({
		name: 'stored-answer',
		initial: 'empty',
		steps: { empty: ['shown'], shown: ['shown', 'kept'], kept: ['shown', 'kept'] }
	});

type StoredAnswer = fsm.RunOf<ReturnType<typeof answer_definition>>;

type PartStates = {
	promised: {};
	landed: { html: VerifiedHtml };
	missed: {};
};

const part_definition = () =>
	$machine<PartStates>()({
		name: 'frame-part',
		initial: 'promised',
		steps: { promised: ['landed', 'missed'], landed: [], missed: [] }
	});

type Part = fsm.RunOf<ReturnType<typeof part_definition>>;

type Entry = {
	answer: StoredAnswer;
	part: Part | null;
	renewed: string | null;
	refused: Error | null;
};

const EVICT_TTL = 60_000;

const MAX_ADDRESSES = 2000;

const HELD = { keep: Infinity };
const LINGER = { keep: EVICT_TTL };

type FrameFlights = Flights<FrameAsk, VerifiedHtml, Pick<FrameAsk, 'a'>>;

type Store = {
	life: Life;
	world: World;
	entries: Cache<string, Entry>;
	flights: FrameFlights;
	answers: ReturnType<typeof answer_definition>;
	parts: ReturnType<typeof part_definition>;
};

const STORE_KEY = '__ogygia_frame_store__';
const store_host = (typeof globalThis !== 'undefined' ? globalThis : {}) as {
	[STORE_KEY]?: Store;
};

function store(): Store {
	return (store_host[STORE_KEY] ??= make_store());
}

function make_store(): Store {
	const own = life.rootLife();
	const entries = cache<string, Entry>({
		name: 'frames',
		max: MAX_ADDRESSES,
		keep: (_e, a) => (live(a) ? Infinity : EVICT_TTL),
		pinned: (_e, a) => live(a),
		owner: own,
		onEvict: (a, e, why) => {
			if (why === 'age' && live(a) && entries.set(a, e, HELD)) return;
			if (e.part !== null) e.part.stop();
			e.answer.stop();
		}
	});
	const frames = plainFlights.keyed<FrameAsk>()({
		name: 'frames',
		key: ['a'],
		ignore: { work: 'one flight per address: a fetch or a batch part out there is joined' },
		keep: 0,
		run: ({ a, work }, signal, flight): Promise<VerifiedHtml | Stale> =>
			typeof work === 'function' ? fetch_frame(a, work, signal, flight) : work
	});
	own.defer(() => frames[life.DISPOSE]());
	return {
		life: own,
		world: world(),
		entries,
		flights: frames,
		answers: answer_definition(),
		parts: part_definition()
	};
}

function shown_of(e: Entry): Shown | null {
	const answer = e.answer;
	return answer.kind === 'empty' ? null : (answer.data as Shown);
}

/** A new stamp of the store's world, newer than every one before it: a fetch or a batch's part
 *  takes one when it is asked for, and a channel that writes from elsewhere (a streamed or mutation
 *  frame) when it writes. */
export function stamp(): number {
	const w = store().world;
	w.bump();
	return w.stamp();
}

/** Where an answer asked for now stands at an address: a new stamp, its entry made. External
 *  channels (streaming, mutations, a live tick) take one too. */
export function ticket(a: string): number {
	entry(a);
	return stamp();
}

async function fetch_frame(
	a: string,
	fetcher: FrameFetcher,
	signal: AbortSignal,
	flight: InFlight
): Promise<VerifiedHtml> {
	const t = stamp();
	let html: VerifiedHtml;
	try {
		html = await fetcher(signal, flight);
	} catch (err) {
		hold_refusal(a, err);
		throw err;
	}
	if (!signal.aborted) write({ a, v: t, html });
	const e = store().entries.peek(a);
	return (e && shown_of(e)?.html) ?? html;
}

const flying = (a: string): boolean => store_host[STORE_KEY]?.flights.peek({ a }) !== undefined;

const live = (a: string): boolean => watcher_count(frame_id(a)) > 0 || flying(a);

function entry(a: string, s: Store = store()): Entry {
	let e = s.entries.peek(a);
	if (!e)
		s.entries.set(
			a,
			(e = { answer: fsm.createRun(s.answers), part: null, renewed: null, refused: null })
		);
	return e;
}

function schedule_evict(a: string, e: Entry): void {
	if (live(a) || store_host[STORE_KEY]?.entries.peek(a) !== e) return;
	store().entries.set(a, e, LINGER);
}

/** Applied content for an address, if any. */
export function peek(a: string): Shown | null {
	const e = store().entries.peek(a);
	const s = e && shown_of(e);
	return s ? { v: s.v, d: s.d, html: s.html } : null;
}

/** The data version of the content applied at an address, if it had one. */
export function shown_version(a: string): number | undefined {
	const e = store().entries.peek(a);
	return e && shown_of(e)?.d;
}

/** A renewal at this address answered `fresh`, the capability its elements fetch with from now on. */
export function renew(a: string, fresh: string): void {
	entry(a).renewed = fresh;
}

/** The fresh capability a renewal at this address answered, if any. */
export function renewal(a: string): string | null {
	return store().entries.peek(a)?.renewed ?? null;
}

/** Nothing applied and nothing in flight at this address (a batch may take it on). */
export function is_idle(a: string): boolean {
	const e = store().entries.peek(a);
	return !e || (shown_of(e) === null && !flying(a));
}

/**
 * Write a frame. Applied only if newer than the current content (`older_by`); older writes are
 * dropped (a `kept` move) and reported `false`. Subscribers are notified on apply.
 */
export function write(f: StoredFrame): boolean {
	const e = entry(f.a);
	const s = shown_of(e);
	const why = older_by(f, s);
	if (why !== null) {
		const shown = s as Shown;
		e.answer.go('kept', {
			v: shown.v,
			d: shown.d,
			html: shown.html,
			dropped: { v: f.v, d: f.d, why }
		});
		return false;
	}
	e.answer.go('shown', { ...stands_at(s, f), html: f.html });
	e.refused = null;
	if (e.part !== null) e.part.move('promised', 'landed', { html: f.html });
	notify(frame_id(f.a), f);
	schedule_evict(f.a, e);
	return true;
}

/**
 * Reserve an address whose content is arriving via an EXTERNAL batch stream (single-flight navigation). A region
 * binder that mounts before its frame lands calls `ensure()`, finds the batch's flight there, and JOINS it
 * instead of starting its own fetch — so a navigation that pulls N regions makes ONE batch request,
 * not N. `write()` lands it when the frame arrives; `release()` misses it if the batch ends without
 * one (a joined binder then asks again, and its own fetch runs). The flight is the batch's: a binder
 * leaving never ends it. No-op if content or a fetch is already present.
 */
export function reserve(a: string): void {
	const e = entry(a);
	if (shown_of(e) !== null || flying(a)) return;
	const s = store();
	const part = (e.part = fsm.createRun(s.parts));
	const landed = part.wait('landed').then((p) => (p === STALE ? STALE : p.html));
	const settled = () => schedule_evict(a, e);
	s.flights.get({ a, work: landed }).then(settled, settled);
}

/**
 * Start the flight at an address for no caller yet (the page's early start: ./early-holes.ts): a
 * hole that asks there joins it. `signal` ends it if nobody joined before. A refusal it gets that no
 * caller heard waits at the address for the first one that asks (`Entry.refused`); a caller that
 * joined heard it, and asks again past it. No-op if content or a fetch is already present.
 */
export function start(a: string, fetcher: FrameFetcher, signal: AbortSignal): void {
	const e = entry(a);
	if (shown_of(e) !== null || flying(a)) return;
	const settled = () => schedule_evict(a, e);
	store().flights.get({ a, work: fetcher }, { signal }).then(settled, settled);
}

/**
 * Miss an unfulfilled batch part (the batch ended and no frame was written at this address, by it or
 * by anyone): joined binders ask again in `ensure()`, and their own fetch runs (nothing failed, the
 * batch just did not carry it). No-op once a frame has landed.
 */
export function release(a: string): void {
	const part = store().entries.peek(a)?.part;
	if (part != null) part.move('promised', 'missed');
}

/**
 * Subscribe to writes at an address. If content is ALREADY applied, the callback fires immediately
 * with it (a late binder — e.g. a region that mounts after a batch stream already delivered its
 * frame — catches up without a request). Returns an unsubscribe fn. While subscribed the entry
 * stays; after the last unsubscribe it lingers EVICT_TTL then goes (unless re-bound).
 */
export function subscribe(a: string, cb: (f: StoredFrame) => void): () => void {
	const e = entry(a);
	const off = watch(frame_id(a), cb as (v: unknown) => void);
	store().entries.set(a, e, HELD);
	const s = shown_of(e);
	if (s !== null) cb({ a, v: s.v, d: s.d, html: s.html });
	return () => {
		off();
		schedule_evict(a, e);
	};
}

/**
 * Ensure an address has content, deduping concurrent callers onto one fetch.
 *
 * - Content already applied (and not `force`): resolves immediately with it.
 * - A fetch (or a batch's part) is in flight (and not `force`): joins it — N regions, ONE request.
 * - Otherwise starts `fetcher` with a fresh stamp; on success the response is WRITTEN (subject to
 *   the staleness check) and the resolved value is whatever the store now holds.
 * - `force` (SWR revalidate) always starts a new fetch, and ends the one out before it: whoever
 *   waited on that one joins the new one. The stamps still guarantee an older response can't
 *   overwrite a newer one.
 *
 * `signal` is the caller's: when it aborts, this caller alone gets `STALE` at once, and the shared
 * fetch is aborted only once its LAST caller left — one unmounting element must not kill a fetch
 * its twin still awaits. Rejections propagate to every joined caller; retry policy stays with the
 * caller (the element). A refusal is held at the address only until a caller hears it: one handed
 * to a caller through its flight is not handed to it again when it asks once more.
 *
 * `priority` is how soon this caller needs it (its load class, ./load-class.ts): a fetch out at a
 * lower one, a warm still waiting for a background turn, is raised to it, never lowered.
 */
export async function ensure(
	a: string,
	fetcher: FrameFetcher,
	opts: { force?: boolean; signal?: AbortSignal; priority?: number } = {}
): Promise<VerifiedHtml | Stale> {
	const { signal, priority } = opts;
	const st = store();
	const e = entry(a);
	let fresh = opts.force === true;
	try {
		for (;;) {
			const s = fresh ? null : shown_of(e);
			if (s !== null) return s.html;
			const refused = e.refused;
			e.refused = null;
			if (!fresh && refused !== null) throw refused;
			let html: VerifiedHtml | Stale;
			try {
				html = await st.flights.get({ a, work: fetcher }, { signal, fresh, priority });
			} catch (err) {
				if (e.refused === err) e.refused = null;
				throw err;
			}
			if (html !== STALE || signal?.aborted || st.life.closed) return html;
			fresh = false;
		}
	} finally {
		schedule_evict(a, e);
	}
}

/** Test/HMR hook — end the store (every reservation fails, every caller of a fetch gets STALE, every
 *  stored answer stops); the next use makes a new one. */
export function _reset(): void {
	const old = store_host[STORE_KEY];
	store_host[STORE_KEY] = undefined;
	if (old !== undefined) old.life.close();
}
