/**
 * A held region's live program: its ticks (`applyLive`), applied as static HTML morphed in place
 * or as an interactive island hydrated and fed props. Part of the live feature (./live.ts), which
 * the hydrate core installs: a build without held regions never ships it, and the boot keeps only
 * the call (./core.ts `#apply_live`). It reaches the element's state and the boot's helpers through
 * `slots.live_link` (./slots.ts `LiveLink`), set by the element before its first tick.
 *
 * @internal
 */
import { STALE, type Turn } from '@ogygia/machine';
import { OG_BAKED } from '../wire-markup.ts';
import { live_link, slots, type LiveTick } from './slots.ts';
import type { VerifiedHtml } from './html-sink.ts';
import type { FrameOrder } from '../frame.ts';
import type { IslandModule } from './hydrate-core.ts';

type HydrateCore = typeof import('./hydrate-core.ts');

const HOOK_ANSWER_PLACED: boolean =
	typeof __OGYGIA_HOOK_ANSWER_PLACED__ !== 'undefined' ? __OGYGIA_HOOK_ANSWER_PLACED__ : true;
const HOOK_REGION_MOUNT: boolean =
	typeof __OGYGIA_HOOK_REGION_MOUNT__ !== 'undefined' ? __OGYGIA_HOOK_REGION_MOUNT__ : true;
const HOOK_REGION_UNMOUNT: boolean =
	typeof __OGYGIA_HOOK_REGION_UNMOUNT__ !== 'undefined' ? __OGYGIA_HOOK_REGION_UNMOUNT__ : true;

/** What a live region's program keeps between its ticks: the frame it painted last, and whether
 *  its first HTML is in. Kept for the element's life, across its moves, as the element did. */
class LiveState {
	painted: FrameOrder | null = null;
	ready = false;
}

const states = new WeakMap<Element, LiveState>();

function state_of(el: Element): LiveState {
	let s = states.get(el);
	if (s === undefined) states.set(el, (s = new LiveState()));
	return s;
}

const hand_back = (release: () => void): void => release();

/** Applies a tick to `el` (see the region element's `applyLive`). */
export async function apply_live(el: HTMLElement, desc: LiveTick, turn: Turn): Promise<void> {
	const link = live_link();
	const live = link.live(el);
	const st = state_of(el);
	el.setAttribute('render', 'defer');
	el.setAttribute('entry', desc.module || desc.id);
	if (desc.url) el.setAttribute('endpoint', desc.url);
	if (desc.hydrate) el.setAttribute('wake', desc.hydrate);
	else el.removeAttribute('wake');
	if (desc.hydrateMargin) el.setAttribute('hydrate-margin', desc.hydrateMargin);

	const interactive = !!desc.hydrate && !!desc.module;

	if (!interactive) {
		const now = live.now;
		const bound = now.kind === 'static' ? now.bound : { address: null };
		if (now.kind !== 'static') live.go('static', { bound });
		const frames = slots.frames;
		if (desc.url && bound.address === null) {
			const box = link.box(el);
			const address = link.frameAddress(desc.url);
			const off = frames?.subscribe(address, (f) => {
				box.post((t) => {
					if (link.older_by(f, st.painted) !== null) return;
					st.painted = link.stands_at(st.painted, f);
					return morph_live(el, f.html, t);
				});
			});
			if (off) {
				bound.address = address;
				live.visit().defer(off);
			}
		}
		const address = desc.url ? link.frameAddress(desc.url) : null;
		const stored = address && frames ? frames.peek(address) : null;
		const mine = address && frames ? (desc.written ??= { v: frames.ticket(address) }) : null;
		const held = stored === null || (stored.v === mine?.v && stored.d === mine.d) ? null : stored;
		const html = link.vouch_remote_answer(desc.html);
		if (mine === null) await morph_live(el, html, turn);
		else if (link.older_by(mine, held) === null && link.older_by(mine, st.painted) === null) {
			st.painted = link.stands_at(held && held.v > (st.painted?.v ?? 0) ? held : st.painted, mine);
			await morph_live(el, html, turn);
		}
		return;
	}

	st.painted = null;
	const s = live.now;
	// Keep-alive: same interactive module, already mounted → reactive prop push, no DOM churn.
	if (s.kind === 'live' && s.module === desc.module && s.app.set_props) {
		s.app.set_props(desc.props);
		el.dispatchEvent(new CustomEvent('ogygia:live', { bubbles: true }));
		return;
	}
	if (s.kind === 'hydrating' && s.module === desc.module) {
		s.pending.props = desc.props;
		return;
	}
	if (s.kind === 'failed' && s.module === desc.module)
		return morph_live(el, link.vouch_remote_answer(desc.html), turn);

	const pending: { props: Record<string, unknown> | null } = { props: null };
	live.go('hydrating', { module: desc.module, pending });
	const mine = live.epoch;
	const paint = link.paint(el);
	paint.go('painting');
	const painting = paint.epoch;
	st.ready = true;
	const { frag, ready, sheets } = link.region_fragment(link.vouch_remote_answer(desc.html));
	// stylesheet before paint — an interactive held region has CSS too (no FOUC). (STALE: the
	// region left the page meanwhile; another tick took over: it paints)
	$await(turn.wait(ready));
	if (live.epoch !== mine) return;
	if (paint.epoch === painting) paint.go('idle');
	link.use_sheets(el, sheets);
	link.settle_in(frag);
	el.replaceChildren(frag);
	if (HOOK_ANSWER_PLACED) slots.hooks?.answerPlaced?.({ el });
	link.init_shadow_registries(el);
	await live_hydrate(el, desc.props, mine, desc.module, pending, turn);
}

async function morph_live(el: HTMLElement, html: VerifiedHtml, turn: Turn): Promise<void> {
	if (!el.isConnected) return;
	const link = live_link();
	const st = state_of(el);
	// BAKED (Region.svelte, PromiseRegionAwait): the first HTML is already here — the page was
	// served with it and hydrated against it. Nothing to paint; later ticks morph as usual (by
	// identity: Svelte's `{@html}` anchors stay among the children — ownership.ts `order_owner`).
	if (!st.ready && el.hasAttribute(OG_BAKED)) {
		st.ready = true;
		el.setAttribute('data-hydrated', '');
		el.dispatchEvent(new CustomEvent('ogygia:live', { bubbles: true }));
		return;
	}
	const paint = link.paint(el);
	paint.go('painting');
	const painting = paint.epoch;
	const { frag, ready, sheets } = link.region_fragment(html);
	$await(turn.wait(ready));
	if (paint.epoch !== painting) return;
	paint.go('idle');
	link.use_sheets(el, sheets);
	link.settle_in(frag);
	if (!st.ready) {
		el.replaceChildren(frag);
		st.ready = true;
		el.setAttribute('data-hydrated', '');
	} else {
		const nodes = Array.from(frag.childNodes);
		const morph = slots.morph;
		if (morph) morph(el, nodes);
		else el.replaceChildren(...nodes);
		for (const inner of el.querySelectorAll('ogygia-region')) link.renew(inner);
	}
	if (HOOK_ANSWER_PLACED) slots.hooks?.answerPlaced?.({ el });
	link.init_shadow_registries(el);
	link.absorb_page_facts_now();
	el.dispatchEvent(new CustomEvent('ogygia:live', { bubbles: true }));
}

async function live_hydrate(
	el: HTMLElement,
	props: Record<string, unknown>,
	mine: number,
	module: string,
	pending: { props: Record<string, unknown> | null },
	turn: Turn
): Promise<void> {
	const link = live_link();
	const live = link.live(el);
	const ours = () => el.isConnected && live.epoch === mine;
	try {
		$await(turn.wait(link.dom_ready()));
		if (!ours()) return;
		const entry = link.island_entry_of(el);
		if (!entry) return;
		const cls = () => link.viewport_class(el);
		const slot = new link.LoadSlot({ kind: 'code', cls, label: entry, el });
		// (gone while it queued: the slot, when it comes, goes straight back)
		// oxlint-disable-next-line ogygia/no-silent-failures -- a slot's turn never fails
		const release = $await(turn.wait(slot.ready), void slot.ready.then(hand_back));
		let mod: IslandModule, core: HydrateCore;
		try {
			if (!ours()) return;
			const loaded = $await(
				turn.wait(
					Promise.all([
						link.load_island(entry, cls()),
						link.hydrate_core(),
						link.devalue_for_wake()
					])
				)
			);
			[mod, core] = loaded;
		} finally {
			release();
		}
		if (!ours()) return;
		link.use_code_sheets(el, mod);
		// (Kit cannot start: the region keeps its swapped HTML, and the wait said why)
		$await(
			turn.wait(core.kit_page_wait(el, live.visit())).catch((err) => {
				if (link.kit_boot_failed(err)) return STALE;
				throw err;
			})
		);
		if (!ours()) return;
		if (HOOK_REGION_MOUNT) link.client_region_mount(el);
		const app = core.hydrate_live(el, entry, mod, props);
		if (!app) return;
		live.go('live', { module, app });
		live.visit().defer(() => {
			if (HOOK_REGION_UNMOUNT)
				slots.hooks?.regionUnmount?.({ el, entry: el.getAttribute('entry') ?? '' });
			app.dispose();
		});
		if (pending.props) app.set_props?.(pending.props);
		el.setAttribute('data-hydrated', '');
		el.dispatchEvent(new CustomEvent('ogygia:hydrated', { bubbles: true }));
		el.dispatchEvent(new CustomEvent('ogygia:live', { bubbles: true }));
	} catch (error) {
		// (a tick that took over, or the region gone: the failure is no longer this visit's)
		if (live.epoch !== mine) return;
		link.say_island_failed(el.getAttribute('entry'), error);
		live.go('failed', { module, error });
	} finally {
		if (live.epoch === mine) live.go('idle');
	}
}
