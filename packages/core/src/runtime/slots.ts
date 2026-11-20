import type { Stale } from '@ogygia/machine';
import type { Life } from '@ogygia/machine/internal';
import type { FrameOrder } from '../frame.ts';
import type { FrameFetcher, StoredFrame } from './frame-store.ts';
import type { VerifiedHtml } from './html-sink.ts';

/** A lake an island's hydrate adopts in place, held by its key to find it again after. */
export type HeldLake = {
	id: string;
	lake: Element;
};

/** Region schedule hooks lakes need without importing the custom element. */
export type LakeArm = {
	idle: (fire: () => void) => void;
	visible: (fire: () => void, margin?: string) => void;
	media: (when: string, fire: () => void) => void;
	fetch_revalidate: () => void;
	wake_children: () => void;
};

export type LakeOps = {
	on_frozen_connect(el: HTMLElement, arm: LakeArm): boolean;
	wait_for_boundary(el: HTMLElement, boundary: Element | null): boolean;
	hold(parent: Element): HeldLake[];
	release(parent: Element, held: HeldLake[]): void;
	settle_in(root: ParentNode): void;
	mark_frozen_settled(region: HTMLElement): void;
	/** After an answer swapped into `region`: a lake that settled wakes the regions waiting on it. */
	after_html_swap(
		region: HTMLElement,
		opts: { revalidate?: boolean },
		wake_children: () => void
	): void;
	after_fetch_exhausted(
		region: HTMLElement,
		opts: { revalidate?: boolean },
		wake_children: () => void
	): void;
};

export type FormOps = {
	snapshot(root: ParentNode, pathKey: string): void;
	restore(pathKey: string): void;
};

/** Wake a cold island when interaction lands inside it; returns a disarm fn (`over`: the region
 *  left while it was waking — the clicks it queued are dropped, not replayed). `fire` gets what
 *  replays the visitor's input (./interaction.ts `WakeFn`): the island goes live once it is in.
 *  `owner`: the region's lifetime in the page, which the replay's frame belongs to. */
export type ArmFn = (
	el: HTMLElement,
	fire: import('./interaction.ts').WakeFn,
	owner: Life
) => void | ((over?: boolean) => void);

/** `target: 'walk'` = the hydration repair (the server sequence Svelte's walk binds); default = a live
 *  morph toward a new answer. Same ownership rules either way (runtime/ownership.ts). `stays`: a
 *  child of `parent` the morph steps over (the page's own, beside the render's). */
export type MorphFn = (
	parent: Element,
	nodes: ArrayLike<Node>,
	options?: { target?: 'live' | 'walk'; stays?: (node: Node) => boolean }
) => void;

export type WireOps = {
	/** THE hub key (`OgygiaRef`) — every transportable kind crosses under it. */
	REF_WIRE_KEY: string;
	/** Hub resolve: ref → live value (kind-dispatched; browser remembers, server never). */
	resolve: (ref: never, remember: boolean) => unknown;
};

export type RemoteSeedOps = {
	/** this document's remote seed into the query cache, once per document */
	seed_once(): void;
	seed_query_responses(text: string): void;
	clear_remote_seeds(): void;
	/** destroy the query instances only departed islands held (shims/kit-remote/remote-cache.ts) */
	release_remote_instances(): void;
};

/** The page as island code sees it, filled by the `page` feature (./seeds.ts). Null when no island
 *  code can read its page: the server ships no seed then, so there is nothing to parse or wait for. */
export type PageOps = {
	/** the document's page seed into the page store (once), then any page facts answers brought */
	seed_page_once(): void;
	/** the `page.data` a seed reference in island props resolves against */
	seed_data_of(doc: Document): unknown;
	/** on a Kit-hydrated document: the wait for Kit to apply its page (`null` once applied), for as
	 *  long as `signal` (the waiting region's visit) lasts */
	kit_page_thread(signal?: AbortSignal): Promise<unknown> | null;
};

/**
 * The client frame store, filled by the `frames` feature. Core reads it ONLY on the deferred /
 * live / SWR-lake paths (a region with a signed `endpoint`), so a plain load-hydrated app never
 * bundles the store. Null until the feature installs → core's frame calls are optional-chained.
 */
export type FrameOps = {
	subscribe(a: string, cb: (f: StoredFrame) => void): () => void;
	/** The frame applied at an address, if any. */
	peek(a: string): (FrameOrder & { html: VerifiedHtml }) | null;
	/** The next request ticket: where an answer arriving now stands at the address. */
	ticket(a: string): number;
	/** `STALE` when its `signal` aborted: only that caller leaves the fetch. A join at a higher
	 *  `priority` (a load class's, ./load-class.ts) raises the fetch it joins. */
	ensure(
		a: string,
		fetcher: FrameFetcher,
		opts?: { force?: boolean; signal?: AbortSignal; priority?: number }
	): Promise<VerifiedHtml | Stale>;
	/** A renewal answered a fresh capability for this address; and the one it answered, if any. */
	renew(a: string, fresh: string): void;
	renewal(a: string): string | null;
	/**
	 * SINGLE-FLIGHT NAVIGATION: batch a page's signed deferred endpoints into the store as one streamed response. Lives
	 * on the seam (not a static router import) so an app with `router` but no deferred/live/lake region
	 * — hence no `frames` feature — never bundles the frame store. The router optional-chains this: no
	 * frames feature ⇒ no `render="defer"` holes to batch ⇒ the call never fires anyway. `visit`: the
	 * scope of the page the holes are for (./session.ts `PageVisit`); the batch stops when it ends.
	 * Grouped as the page's first holes are (frame-nav.ts `send_batches`, #987), and naming `page`,
	 * the page they are for, as their referrer (#995).
	 */
	stream(endpoints: string[], visit: Life, page: string): Promise<unknown>;
	/** Holes that start fetching in the same task go out as one batch (frame-nav.ts `join_batch`);
	 *  await it, then `ensure` joins the batch's reservation. */
	join?(endpoint: string): Promise<void>;
	/** How the batch that carried a hole timed it (frame-nav.ts; the measuring browser only). */
	batch_times?(endpoint: string): { left: number; at: number; size: number } | undefined;
};

/**
 * SPA navigation, filled by the router feature. Read by the kit-remote client stub (used by the
 * always-on remote-seeds feature) so a remote COMMAND can navigate/invalidate WITHOUT the stub
 * statically importing `router.js` (~10 KB). Null when no router loaded → callers full-page fallback.
 */
export type NavOps = {
	goto(url: string | URL, opts?: unknown): Promise<void>;
	invalidateAll(): Promise<void>;
};

/**
 * BOOT → LAZY LINKS. The runtime's lazy chunks — the hydrate core, the router's navigation,
 * interaction replay — use a handful of boot helpers and the boot's session state. They reach them
 * HERE, never by importing a boot module: a module the boot and a lazy chunk both import is shared,
 * and Kit's client build (`preserveEntrySignatures: 'strict'`) forbids the runtime chunk from
 * exporting it, so the bundler splits every such module into a file of its own — the runtime's
 * boot arrived as nine. Each link is filled before its lazy chunk can load: `boot` by core's boot
 * (./boot-link.ts), `router_link`, `interaction_link` and `live_link` by the very loader that imports
 * their chunk (the router's `nav()`, interaction's `replay()`, the region element's tick), `sync_attributes` by morph's install. Types only
 * below (erased), so this registry imports none of them.
 * `test/runtime-boot-svelte-free.test.ts` pins that no lazy chunk imports a boot module.
 * The boot link is read by number (`boot_link()[L_PROPS_SIDECAR_OF]`, ./boot-link-index.ts), so no
 * helper's name ships: its places are this tuple's, in order.
 */
export type BootLink = [
	kit_hydrates_page: typeof import('./kit-boot.ts').kit_hydrates_page,
	/** does Kit hydrate a fetched document; without the kit-pages feature, its server's meta alone */
	KitBoot: { document_has(doc: ParentNode): boolean },
	ABSOLUTE_URL_SCHEME: RegExp,
	register_island_graph: typeof import('./island-graph-preload.ts').register_island_graph,
	is_warmed_module: typeof import('./region-endpoint-url.ts').is_warmed_module,
	warm_island_module: typeof import('./region-endpoint-url.ts').warm_island_module,
	runs_entry: typeof import('./region-attrs.ts').runs_entry,
	note_entry_location: typeof import('./entry-locations.ts').note_entry_location,
	props_sidecar_of: typeof import('./sidecar.ts').props_sidecar_of,
	parse_region_html: typeof import('./html-sink.ts').parse_region_html,
	parse_page_document: typeof import('./html-sink.ts').parse_page_document,
	init_shadow_registries: typeof import('./html-sink.ts').init_shadow_registries,
	set_inner_html: typeof import('./html-sink.ts').set_inner_html,
	vouch_page_answer: typeof import('./html-sink.ts').vouch_page_answer,
	vouch_page_html: typeof import('./html-sink.ts').vouch_page_html,
	runtime_session: typeof import('./session.ts').runtime_session,
	regions_in_shadow: typeof import('./connected.ts').regions_in_shadow,
	/** the region head nodes a navigation's head merge left, taken out but for those a region on
	 *  the page uses or owns */
	release_head_nodes: typeof import('./region-sheets.ts').release_head_nodes,
	/** the islands a region head tag names as its owners, and adding to them (../head-owners.ts) */
	head_owners: typeof import('../head-owners.ts').head_owners,
	add_head_owners: typeof import('../head-owners.ts').add_head_owners,
	adopt_owner_record: typeof import('../head-owners.ts').adopt_owner_record,
	yield_task: typeof import('./schedule.ts').yield_task,
	/** the `regionHydrate` subscribers around Svelte's hydrate over server markup (./client-plugins.ts) */
	region_hydrate: typeof import('./client-plugins.ts').client_region_hydrate,
	/** DOM ownership (./ownership.ts): which children Svelte's walk enters, and self-owned elements */
	walk_enters: typeof import('./ownership.ts').walk_enters,
	is_self_owned: typeof import('./ownership.ts').is_self_owned,
	/** `<body>`'s two owners (./ownership.ts): the router's record of what the server sent it */
	record_server_body: typeof import('./ownership.ts').record_server_body,
	server_body_attributes: typeof import('./ownership.ts').server_body_attributes,
	server_body_child: typeof import('./ownership.ts').server_body_child,
	/** a document's side channels, the server's own only (./response-mark.ts, RESPONSE-MARK) */
	server_channel: typeof import('./response-mark.ts').server_channel,
	/** the kept runtime script takes the next response's mark and code origins (./response-mark.ts) */
	adopt_response: typeof import('./response-mark.ts').adopt_response,
	/** the load scheduler's queue (./load-scheduler.ts), and a load class as a flight priority and
	 *  as a fetch priority (./load-class.ts) */
	LoadSlot: typeof import('./load-scheduler.ts').LoadSlot,
	PRIORITY: typeof import('./load-class.ts').PRIORITY,
	fetch_priority_of: typeof import('./load-class.ts').fetch_priority_of,
	/** devalue, loaded when a page needs it (./devalue-lane.ts) */
	load_devalue: typeof import('./devalue-lane.ts').load_devalue,
	devalue: typeof import('./devalue-lane.ts').devalue,
	with_devalue: typeof import('./devalue-lane.ts').with_devalue,
	needs_devalue: typeof import('./devalue-lane.ts').needs_devalue,
	/** the runtime's messages (../messages/core.ts), as a lazy chunk throws and logs them (../messages/lazy.ts) */
	OgygiaError: typeof import('../messages/core.ts').OgygiaError,
	warn: typeof import('../messages/core.ts').warn,
	/** what a machine's task answers once its visit is left (`@ogygia/machine`, which the boot runs on) */
	STALE: typeof import('@ogygia/machine').STALE,
	/** keyed shared async work (`@ogygia/machine`): the router's page fetches */
	flights: typeof import('@ogygia/machine').flights,
	/** a bounded, owned store (`@ogygia/machine`): the router's per-address memos */
	cache: typeof import('@ogygia/machine').cache,
	/** a stamp that only moves forward (`@ogygia/machine`): the world the router's page cache is
	 *  made in */
	world: typeof import('@ogygia/machine').world,
	/** the page's soft refresh (./soft-refresh.ts): `invalidateAll`, with the router or without it */
	soft: import('./soft-refresh.ts').SoftRefresh,
	/** a region's attributes as the hydrate core reads them (./region-attrs.ts); the truncation
	 *  check is dev's alone (null in a production build) */
	is_deferred: typeof import('./region-attrs.ts').is_deferred,
	ours_on_kit_document: typeof import('./region-attrs.ts').ours_on_kit_document,
	region_ssr_truncated: typeof import('./region-attrs.ts').region_ssr_truncated | null
];
export type RouterLink = {
	jump_to_hash: typeof import('./router.ts').jump_to_hash;
	fragment_target: typeof import('./fragment.ts').fragment_target;
};
export type InteractionLink = {
	resolve_address: typeof import('./interaction.ts').resolve_address;
};

/** A held region's tick, as `applyLive` takes it (./core.ts, ./live-program.ts). */
export type LiveTick = {
	id: string;
	module: string;
	props: Record<string, unknown>;
	html: string;
	url?: string;
	hydrate?: string;
	hydrateMargin?: string;
	written?: import('../frame.ts').FrameOrder | undefined;
};

/** What the live program (./live-program.ts) reaches in the boot: a region element's live and
 *  paint machines and mailbox, its nested regions' refresh, and the boot's helpers it shares with
 *  the element's other programs. Set by the element's loader of that chunk (./core.ts). */
export type LiveLink = {
	live: (el: Element) => import('./region-machines.ts').Live;
	paint: (el: Element) => import('./region-machines.ts').Paint;
	box: (el: Element) => import('@ogygia/machine').Mailbox;
	/** A nested region refreshes against the HTML that came in around it. */
	renew: (el: Element) => void;
	region_fragment: typeof import('./core.ts').region_fragment;
	settle_in: (frag: DocumentFragment) => void;
	absorb_page_facts_now: () => void;
	use_sheets: typeof import('./region-sheets.ts').use_sheets;
	use_code_sheets: typeof import('./region-sheets.ts').use_code_sheets;
	init_shadow_registries: typeof import('./html-sink.ts').init_shadow_registries;
	vouch_remote_answer: typeof import('./html-sink.ts').vouch_remote_answer;
	frameAddress: typeof import('../frame.ts').frameAddress;
	older_by: typeof import('../frame.ts').older_by;
	stands_at: typeof import('../frame.ts').stands_at;
	island_entry_of: typeof import('./entry-locations.ts').island_entry_of;
	viewport_class: typeof import('./load-scheduler.ts').viewport_class;
	LoadSlot: typeof import('./load-scheduler.ts').LoadSlot;
	load_island: (
		entry: string,
		cls: import('./load-scheduler.ts').LoadClass
	) => Promise<import('./hydrate-core.ts').IslandModule>;
	hydrate_core: () => Promise<typeof import('./hydrate-core.ts') | import('@ogygia/machine').Stale>;
	devalue_for_wake: () => Promise<unknown> | undefined;
	dom_ready: () => Promise<unknown>;
	kit_boot_failed: (err: unknown) => boolean;
	say_island_failed: (entry: string | null, err: unknown) => void;
	client_region_mount: typeof import('./client-plugins.ts').client_region_mount;
};

/** What an island's wake in the hydrate core (./hydrate-core.ts `wake_island`) reaches in the
 *  boot: the region element's visitor replay, island and server copy, and the boot helpers of the
 *  wake. Set by the element before its first wake (./core.ts). */
export type WakeLink = {
	visitor: (el: Element) => Promise<unknown> | null;
	app: (el: Element) => import('./hydrate-core.ts').IslandHandle | null;
	ssr_html: (el: Element) => string | null;
	/** The island is in (or the hydrate step gave none): the element holds it, and lets its server
	 *  copy and its sleep watch go. */
	hydrated: (el: Element, app: import('./hydrate-core.ts').IslandHandle | null) => void;
	use_code_sheets: typeof import('./region-sheets.ts').use_code_sheets;
	hydrate_turn: typeof import('./schedule.ts').hydrate_turn;
	region_changed: typeof import('./drift-watch.ts').region_changed;
	/** Dev: a Svelte hydration warning raised from here on is this island's. */
	hydrating: (el: Element) => void;
	/** Rules: the island mounted. */
	mounted: (el: Element) => void;
};

export type Slots = {
	/** lakes, set by their feature's install (./lakes.ts); null in a build without them */
	lakes: LakeOps | null;
	/** form continuity, set by its feature's install (./form-continuity.ts); null without it */
	forms: FormOps | null;
	interaction: ArmFn | null;
	morph: MorphFn | null;
	/** props a live region or a kept island is hydrated with, pushed in place later (./live.ts) */
	Pushable: typeof import('./pushable-props.svelte.ts').PushableProps | null;
	wire: WireOps | null;
	/** The transportable classes an island's props, context and seeds need, loaded before it
	 *  decodes (./wire-classes.ts). Null in an app without transportable classes: nothing to load. */
	wire_classes: ((region: Element) => Promise<unknown> | null) | null;
	remoteSeeds: RemoteSeedOps | null;
	page: PageOps | null;
	frames: FrameOps | null;
	nav: NavOps | null;
	/**
	 * Cross-island context bridge, filled by the `context` feature. Walks the DOM from an island up
	 * to seed its `getContext` from a `<Provide>` / drop-in-`setContext` marker above it. Null when the
	 * build detected no ogygia context provider — a plain app never bundles the ~4.7 kB bridge, and
	 * core's call optional-chains to `undefined` (exactly "no provider above", the existing empty case).
	 */
	context: ((start: Element | null) => Map<string | symbol, unknown> | undefined) | null;
	/** Boot helpers + session for the lazy chunks (see {@link BootLink}). */
	boot: BootLink | null;
	/** The router's history/scroll helpers for its navigation chunk (see {@link RouterLink}). */
	router_link: RouterLink | null;
	/** Interaction's address resolver for its replay chunk (see {@link InteractionLink}). */
	interaction_link: InteractionLink | null;
	/** The region element's state and the boot's helpers for the live program (see {@link LiveLink}). */
	live_link: LiveLink | null;
	/** A held region's ticks, set by the live feature's install in the hydrate core (./live.ts). */
	live_program: typeof import('./live-program.ts').apply_live | null;
	/** The region element's state and the boot's helpers for an island's wake (see {@link WakeLink}). */
	wake_link: WakeLink | null;
	/** Morph's attribute sync, for the navigation's body reconcile. */
	sync_attributes: typeof import('./morph.ts').sync_attributes | null;
	/** The runtime hooks the plugins' browser halves subscribe to, set at boot only when one does
	 *  (./client-plugins.ts). */
	hooks?: Partial<import('../contract/runtime-hooks.ts').RuntimeHooks>;
};

/** The live registry. A feature's `install()` assigns its slot; core/router read them. */
export const slots: Slots = {
	lakes: null,
	forms: null,
	interaction: null,
	morph: null,
	Pushable: null,
	wire: null,
	wire_classes: null,
	remoteSeeds: null,
	page: null,
	frames: null,
	nav: null,
	context: null,
	boot: null,
	router_link: null,
	interaction_link: null,
	live_link: null,
	live_program: null,
	wake_link: null,
	sync_attributes: null
};

function linked<T>(link: T | null, name: string): T {
	if (link === null)
		throw new Error(`[ogygia] https://ogygiajs.dev/e/slot_not_linked?name=${name}`);
	return link;
}
export const boot_link = (): BootLink => linked(slots.boot, 'boot');
export const router_link = (): RouterLink => linked(slots.router_link, 'router_link');
export const interaction_link = (): InteractionLink =>
	linked(slots.interaction_link, 'interaction_link');
export const live_link = (): LiveLink => linked(slots.live_link, 'live_link');
export const wake_link = (): WakeLink => linked(slots.wake_link, 'wake_link');
export const morph_sync_attributes = (): NonNullable<Slots['sync_attributes']> =>
	linked(slots.sync_attributes, 'sync_attributes');
