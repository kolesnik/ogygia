import { on_schedule, TRIGGER_MISSING } from '../contract/trigger.ts';
import { say_trigger } from './schedule-said.ts';
import { clock } from '@ogygia/machine';
import * as fsm from '@ogygia/machine/internal';
import { lru, type Lru } from '@ogygia/machine/internal';
import {
	FROZEN_SELECTOR,
	document_is_stored,
	is_awake,
	is_frozen,
	region_is_vacant,
	region_max_age_ms,
	region_on_expire,
	region_remount
} from './region-attrs.ts';
import { runtime_session, type PageVisit, type RuntimeSession } from './session.ts';
import { slots, type HeldLake, type LakeArm } from './slots.ts';
import { warn } from '../messages/core.ts';
import { OG_LAKE } from '../wire-markup.ts';
import { note_lake_restore } from './rules.ts';

const LAKE_CACHE_MAX = 64;

/** Cached SSR DOM (+ optional SWR endpoint) for `{#if}` remount of hydrate:none regions.
 * Keyed by lake entry id — size is O(unique lakes on the page), not O(toggles).
 * The page visit's: gone with it. SWR refresh replaces the entry (does not grow). */
export type LakeCacheEntry = {
	frag: Node;
	endpoint: string;
	when: string;
	/** `clock.mono()` when this entry was first cached or last successfully revalidated. */
	cachedAt: number;
	/** Client TTL in ms; `0` = no expiry. */
	maxAgeMs: number;
};

const LAKE = $machine<{ open: {}; waited: {}; settling: {}; settled: {} }>()({
	name: 'lake',
	initial: 'open',
	steps: {
		open: ['waited', 'settled'],
		waited: ['settling', 'settled'],
		settling: ['settled'],
		settled: []
	}
});
type LakeMachine = fsm.RunOf<typeof LAKE>;

/** What one page visit keeps of its lakes. */
type VisitLakes = {
	/** Its lakes' cached server DOM, for an `{#if}` remount. */
	readonly cache: Lru<string, LakeCacheEntry>;
	/** The lake ids whose first connect on this page ran. */
	readonly initialized: Set<string>;
};

/**
 * A page's lakes: each lake element's settle machine, and, per page visit (a session's
 * `PageVisit`), the cache of their server DOM and the lakes that connected once. The lakes
 * feature's own: a build without lakes never carries it. The visit's part goes with the visit.
 */
export class LakeState {
	readonly #session: RuntimeSession;
	/** Each lake element's {@link LAKE} machine, made the first time it is asked about. */
	#lakes = new WeakMap<Element, LakeMachine>();
	#visits = new WeakMap<PageVisit, VisitLakes>();

	constructor(session: RuntimeSession) {
		this.#session = session;
	}

	#visit(): VisitLakes {
		const visit = this.#session.visit;
		let lakes = this.#visits.get(visit);
		if (lakes === undefined) {
			const owner = visit.scope;
			const kept = lru<string, LakeCacheEntry>({
				name: 'lake cache',
				max: LAKE_CACHE_MAX,
				owner
			});
			this.#visits.set(visit, (lakes = { cache: kept, initialized: new Set() }));
		}
		return lakes;
	}

	/** The page's cache of its lakes' server DOM. */
	get lake_cache(): Lru<string, LakeCacheEntry> {
		return this.#visit().cache;
	}

	/** The lake ids whose first connect on this page ran. */
	get initialized_lakes(): Set<string> {
		return this.#visit().initialized;
	}

	#lake(el: Element): LakeMachine {
		let m = this.#lakes.get(el);
		if (m === undefined) this.#lakes.set(el, (m = fsm.create(LAKE)));
		return m;
	}

	/** May the regions authored in this lake run (its content is in, or it never gets any)? */
	lake_settled(el: Element): boolean {
		const m = this.#lakes.get(el);
		const kind = m === undefined ? undefined : m.kind;
		return kind === 'settled' || kind === 'settling';
	}

	/** The lake's content is in now (put back by its host, swapped in by a navigation, there as it
	 *  stands, or kept after a refresh failed for good): every region in it runs. Ones that waited came
	 *  back with the content (moved, they reconnect) or are woken by the caller. */
	settle_lake(el: Element): void {
		const m = this.#lake(el);
		if (m.kind !== 'settled') m.go('settled');
	}

	/** A refresh's answer is in hand, its swap not done: the regions that connect from now on run (they
	 *  come with the swap), and the ones that waited are woken by {@link wake_lake} after it. */
	settle_lake_before_swap(el: Element): void {
		const m = this.#lake(el);
		if (m.kind === 'open') m.go('settled');
		else if (m.kind === 'waited') m.go('settling');
	}

	/** A region in an unsettled lake waits on it: `true` when it must (the lake is not settled). */
	wait_on_lake(el: Element): boolean {
		const m = this.#lake(el);
		if (m.kind === 'open') m.go('waited');
		return m.kind === 'waited';
	}

	/** After the lake's swap: `true` when regions waited on it and are to be woken now. */
	wake_lake(el: Element): boolean {
		const m = this.#lakes.get(el);
		if (m === undefined || (m.kind !== 'settling' && m.kind !== 'waited')) return false;
		m.go('settled');
		return true;
	}

	/** Every lake at or under `root` is settled. */
	settle_lakes_in(root: ParentNode): void {
		if (root instanceof Element && root.matches?.(FROZEN_SELECTOR)) this.settle_lake(root);
		for (const lake of root.querySelectorAll(FROZEN_SELECTOR)) this.settle_lake(lake);
	}
}

/** The document's lakes, on the runtime's session. */
export const lake_state: LakeState = new LakeState(runtime_session);

/** Feature entry: fill the `lakes` slot so core holds/releases frozen regions. */
export function install(): void {
	slots.lakes = {
		on_frozen_connect,
		wait_for_boundary,
		hold,
		release,
		settle_in,
		mark_frozen_settled,
		after_html_swap,
		after_fetch_exhausted
	};
}

export function settle_in(root: ParentNode): void {
	lake_state.settle_lakes_in(root);
}

const hosted_lakes_of = (parent: Element) =>
	[...parent.querySelectorAll(FROZEN_SELECTOR)].filter(
		(l) => l.parentElement?.closest('ogygia-region') === parent
	);

const lake_identity_of = (lake: Element) =>
	lake.getAttribute(OG_LAKE) || lake.getAttribute('entry') || '';

function lake_key(lake: Element): string {
	const identity = lake_identity_of(lake);
	if (!identity) return '';
	let rank = 0;
	for (const other of lake.ownerDocument.querySelectorAll(FROZEN_SELECTOR)) {
		if (other === lake) break;
		if (lake_identity_of(other) === identity) rank++;
	}
	return rank ? `${identity}#${rank}` : identity;
}

/** Each lake `parent`'s hydrate is about to adopt, by its key. Nothing moves. */
export function hold(parent: Element): HeldLake[] {
	return hosted_lakes_of(parent).map((lake) => ({ id: lake_key(lake), lake }));
}

/** After the hydrate: each lake `parent` holds now is settled and remembered, and the regions that
 *  waited on it run. A lake the hydrate created fresh (Svelte threw the server DOM away) takes the
 *  content of the one it held under that key. */
export function release(parent: Element, held: HeldLake[]): void {
	const by_key = new Map(held.map((h) => [h.id, h.lake]));
	let found = 0;
	for (const lake of hosted_lakes_of(parent)) {
		const id = lake_key(lake);
		const was = by_key.get(id);
		if (was) found++;
		const moved = !!was && was !== lake && !was.isConnected;
		settle_in(lake);
		lake_state.initialized_lakes.add(id);
		if (moved) {
			settle_in(was);
			const endpoint = was.getAttribute('endpoint');
			if (endpoint && !lake.getAttribute('endpoint')) lake.setAttribute('endpoint', endpoint);
			while (was.firstChild) lake.appendChild(was.firstChild);
		}
		remember(lake, id, {
			endpoint: lake.getAttribute('endpoint') || '',
			when: lake.getAttribute('when') || 'load',
			maxAgeMs: region_max_age_ms(lake)
		});
		if (!moved)
			for (const r of lake.querySelectorAll('ogygia-region'))
				(r as HTMLElement & { connectedCallback?(): void }).connectedCallback?.();
	}
	note_lake_restore(parent, held.length, found);
}

function unhosted(el: Element): boolean {
	const host = el.parentElement?.closest('ogygia-region');
	return !host || !is_awake(host);
}

function remember(
	lake: Element,
	id: string,
	meta: { endpoint: string; when: string; maxAgeMs: number }
) {
	const policy = region_remount(lake);
	if (!((policy === 'cache' || policy === 'swr') && id && !lake_state.lake_cache.has(id))) return;
	const cached = document.createDocumentFragment();
	for (const child of Array.from(lake.childNodes)) {
		cached.appendChild(child.cloneNode(true));
	}
	lake_state.lake_cache.set(id, {
		frag: cached,
		endpoint: meta.endpoint,
		when: meta.when,
		cachedAt: clock.mono(),
		maxAgeMs: meta.maxAgeMs || region_max_age_ms(lake)
	});
}

/** Revalidates `el`'s lake on its schedule `when`; a schedule whose arm the build left out runs at
 *  once and says so. */
function revalidate_on(el: HTMLElement, when: string, arm: LakeArm): void {
	if (on_schedule(when, arm, arm.fetch_revalidate) === TRIGGER_MISSING) {
		say_trigger(el, when, TRIGGER_MISSING);
	}
}

export function on_frozen_connect(el: HTMLElement, arm: LakeArm): boolean {
	if (!is_frozen(el)) return false;
	const id = lake_key(el);
	if (!lake_state.initialized_lakes.has(id)) {
		if (region_remount(el) === 'swr' && el.getAttribute('endpoint') && document_is_stored()) {
			revalidate_on(el, el.getAttribute('when') || 'load', arm);
		} else if (
			import.meta.env.DEV &&
			region_remount(el) === 'swr' &&
			!el.parentElement?.closest('ogygia-region')
		) {
			warn('live_region_no_host', { id: el.getAttribute('entry') || id });
		}
		if (unhosted(el)) {
			lake_state.settle_lake(el);
			if (!region_is_vacant(el)) {
				remember(el, id, {
					endpoint: el.getAttribute('endpoint') || '',
					when: el.getAttribute('when') || 'load',
					maxAgeMs: region_max_age_ms(el)
				});
				lake_state.initialized_lakes.add(id);
			}
		}
		return true;
	}
	if (!region_is_vacant(el)) {
		if (unhosted(el)) lake_state.settle_lake(el);
		return true;
	}
	const policy = region_remount(el);
	switch (policy) {
		case 'empty':
			lake_state.settle_lake(el);
			return true;
		case 'cache':
		case 'swr': {
			const cached = lake_state.lake_cache.peek(id);
			if (!cached) {
				lake_state.settle_lake(el);
				return true;
			}
			const max_age = region_max_age_ms(el) || cached.maxAgeMs || 0;
			const expired = max_age > 0 && clock.mono() - cached.cachedAt > max_age;
			const on_expire = region_on_expire(el);

			if (expired && on_expire === 'empty') {
				lake_state.settle_lake(el);
				return true;
			}

			if (expired && on_expire === 'fetch') {
				if (!cached.endpoint) {
					lake_state.settle_lake(el);
					return true;
				}
				el.setAttribute('endpoint', cached.endpoint);
				revalidate_on(el, el.getAttribute('when') || cached.when || 'load', arm);
				return true;
			}

			if (policy === 'cache') {
				lake_state.settle_lake(el);
				el.appendChild(cached.frag.cloneNode(true));
				return true;
			}
			el.appendChild(cached.frag.cloneNode(true));
			if (!cached.endpoint) {
				lake_state.settle_lake(el);
				arm.wake_children();
				if (import.meta.env.DEV) {
					warn('live_region_no_endpoint', { id: el.getAttribute('entry') || id });
				}
				return true;
			}
			el.setAttribute('endpoint', cached.endpoint);
			revalidate_on(el, el.getAttribute('when') || cached.when || 'load', arm);
			return true;
		}
		default: {
			const _exhaustive: never = policy;
			return _exhaustive;
		}
	}
}

/**
 * A region authored in an unsettled lake waits on it (session.ts `LAKE`: `waited`). The lake's
 * settling wakes the ones that waited, on every path it settles by: a refresh that MORPHS its
 * children in place reconnects none of them (a vacant swr remount's cached copy, refreshed), so
 * nothing else would.
 */
export function wait_for_boundary(_el: HTMLElement, boundary: Element | null): boolean {
	return !!boundary && is_frozen(boundary) && lake_state.wait_on_lake(boundary);
}

export function mark_frozen_settled(region: HTMLElement): void {
	if (is_frozen(region)) lake_state.settle_lake_before_swap(region);
}

export function after_html_swap(
	region: HTMLElement,
	opts: { revalidate?: boolean },
	wake_children: () => void
): void {
	if (!is_frozen(region)) return;
	if (lake_state.wake_lake(region)) wake_children();
	if (!opts.revalidate) return;
	const id = lake_key(region);
	if (!id) return;
	const cached = document.createDocumentFragment();
	for (const child of Array.from(region.childNodes)) {
		cached.appendChild(child.cloneNode(true));
	}
	const prev = lake_state.lake_cache.peek(id);
	lake_state.lake_cache.set(id, {
		frag: cached,
		endpoint: region.getAttribute('endpoint') || prev?.endpoint || '',
		when: region.getAttribute('when') || prev?.when || 'load',
		cachedAt: clock.mono(),
		maxAgeMs: region_max_age_ms(region) || prev?.maxAgeMs || 0
	});
}

export function after_fetch_exhausted(
	region: HTMLElement,
	opts: { revalidate?: boolean },
	wake_children: () => void
): void {
	if (opts.revalidate && is_frozen(region) && region.isConnected) {
		lake_state.settle_lake(region);
		wake_children();
	}
}
