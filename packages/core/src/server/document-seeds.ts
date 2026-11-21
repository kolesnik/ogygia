/**
 * THE PAGE SEED AND THE REMOTE SEED of a csr=false document: the side-channels its islands read
 * `$page` and their remote queries from. Each is written only where the build's word holds the
 * runtime feature that reads it (`page`, `remote-seeds`): hooks.ts tests `HAS & F_PAGE` /
 * `HAS & F_REMOTE_SEEDS` at every call, so a server whose runtime reads neither carries none of
 * this code, and never writes into a page what the page cannot revive (test/server-seed-word.test.ts).
 */
import { STALE } from '@ogygia/machine';
import type { RequestEvent } from '@sveltejs/kit';
import type { RequestState } from './kit-request-store.ts';
import * as devalue from 'devalue';
import { transport as app_transport } from 'ogygia:region';
import { create_remote_key } from 'ogygia:server';
import { analyze } from '../seed-refs.ts';
import { SeedIndex } from '../seed-index.ts';
import type { PageSnapshot } from '../page-seed-registry.ts';
import type { RequestFacts } from '../plugin/facts.ts';
import { request_scope } from '../plugin/request-scope.ts';
import { PAGE_DEFER_BOOTSTRAP } from '../page-defer.ts';
import { REGION_BRAND } from '../region-brand.ts';
import { OG_FORMAT, OGYGIA_PAGE } from '../wire-markup.ts';
import { RESPONSE_MARK } from '../contract/response-mark.ts';
import type { DocumentTail } from './document-tail.ts';
import { ogygia_script } from './document-assembly.ts';
import { PageSeed, type SeedText } from './page-seed.ts';
import {
	page_seed_reducers,
	settle_deferred,
	stage_deferred,
	type Deferred
} from './page-stream.ts';
import { WIRE_FORMAT_JSON } from './props-wire.ts';
import { collect_remote_seed } from './remote-seed-gate.ts';
import { mark_attr, response_mark } from './response-mark.ts';
import { shape_page_data, unshipped_attr, type SeedKeys } from './seed-shape.ts';

const RULES =
	import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);

/** What the page seed reads of the request's bag, and what it leaves there for the stream that
 *  follows the document (hooks.ts `RequestBag`). */
export interface SeedBag {
	readonly request: Request;
	readonly page: PageSnapshot | null;
	readonly seed_keys: SeedKeys | null;
	readonly tail: DocumentTail;
	readonly facts: RequestFacts;
	deferred: Deferred[] | null;
	defer_next_id: number;
	seed_reducers: Record<string, (v: unknown) => unknown> | null;
}

/** The page seed as it shipped: its text (null: a render outside a request event writes none), the
 *  document tail written against it, and the slice of `page.data` it carries under the keys it
 *  ships (the profiler's explainer reads both). */
export interface ShippedSeed {
	payload: SeedText | null;
	tail_html: string;
	data: unknown;
	keys: SeedKeys;
}

type SeedCodecs = {
	seed_reducers: Record<string, (v: unknown) => unknown>;
	seed_stringify: typeof devalue.stringify;
};
const NO_TRANSPORT = {};
const seed_codec_cache = new WeakMap<object, SeedCodecs>();

/** The app's universal `transport` ENCODERS (custom types the app teaches Kit) with the
 *  DeferRef/SettledRef marker reducers, so a load's custom types round-trip into islands. Built
 *  once per app transport (the same object on every request), not per request. */
function seed_codecs(
	transport: Record<string, { encode: (v: unknown) => unknown }> | undefined
): SeedCodecs {
	const key = transport ?? NO_TRANSPORT;
	let hit = seed_codec_cache.get(key);
	if (!hit) {
		const encoders = Object.fromEntries(
			Object.entries(transport ?? {}).map(([name, codec]) => [name, codec.encode])
		);
		const seed_reducers = { ...encoders, ...page_seed_reducers };
		hit = {
			seed_reducers,
			seed_stringify: ((v: unknown) =>
				devalue.stringify(v, seed_reducers)) as typeof devalue.stringify
		};
		seed_codec_cache.set(key, hit);
	}
	return hit;
}

/**
 * The page seed of a document some region asked it of (`bag.seed_keys`), into `scripts` in the
 * document's order: the defer bootstrap (a streamed load on a browser navigation), the document
 * tail (rendered against the seed, so a sidecar that points into it is written as a reference),
 * then the seed itself (PAGE-DUP, PAGE-SEED-EVENT). STALE: the visitor left while a load's
 * promises settled, and nobody reads the document.
 */
export async function ship_page_seed(
	bag: SeedBag,
	event: RequestEvent | undefined,
	detail: boolean,
	scripts: string[]
): Promise<ShippedSeed | typeof STALE> {
	const page_snap = bag.page!;
	// THE DOCUMENT TAIL (server/document-tail.ts): the regions' module-preload hints, then their
	// props sidecars, rendered ONCE now that the seed ships, every island's sidecar relative to it
	// (seed-refs.ts), whichever rendered first. The index is over the FULL `page.data`, whatever
	// shaping keeps below: a reference path is structural (a top-level key, then keys and indices
	// down), shaping keeps top-level keys whole, and staging / settling keep the shape too, so a
	// path into the full tree resolves identically against the shipped seed, provided its key
	// ships. The plan records the keys it referenced (`touched`) for exactly that.
	const index = SeedIndex.of(page_snap.data);
	const tail_html = bag.tail.render(index, detail, mark_attr(bag.request));
	// SEED SHAPING: the slice of `page.data` the page's islands read (server/seed-shape.ts). A key
	// no island's code reads but whose node an island's props point into ships too: a reference
	// must have something to point at.
	const keys = bag.seed_keys!;
	if (keys !== 'all') for (const k of index.touched) keys.add(k);
	const shaped_data = shape_page_data(page_snap.data, keys);
	let seed_data = shaped_data;
	let seed_form = page_snap.form;
	const { seed_reducers, seed_stringify } = seed_codecs(app_transport);
	// ONE walk of the seed tree (seed-refs.ts `analyze`, against the request's shared memo: the
	// tail's index above already measured every node) answers both questions below: a streamed
	// promise inside (stage or settle), JSON-exact (the native lane).
	const data_shape = analyze(shaped_data);
	const form_shape = analyze(page_snap.form ?? null);
	// A load may return promises at any level (Kit streaming). csr=false can't hydrate the PAGE, so
	// Kit's own resolve stream is dead there, but an ISLAND has a client:
	//  - a real browser load (`Sec-Fetch-Mode: navigate`) can consume a stream: each promise is
	//    STAGED to a marker (a pending Promise on the client) and a resolve `<script>` streams per
	//    settle after the document (hooks.ts `stream_page_deferred`); the inline bootstrap defines
	//    the resolve global before any resolve script runs;
	//  - a programmatic fetch (the router, mode != navigate) can't run streamed scripts, so the
	//    promises SETTLE here and the seed carries resolved values.
	const has_pending = data_shape.thenable || form_shape.thenable;
	// (a page with streaming promises is per-request BY INTENT, even where they settle into a
	// complete document: a stored copy would keep one settle forever while browser loads stream)
	if (has_pending) bag.facts.reads.visitor('streamed load (promise in page data)');
	if (has_pending && event?.request.headers.get('sec-fetch-mode') === 'navigate') {
		const staged_data = stage_deferred(shaped_data, 0);
		const staged_form = stage_deferred(page_snap.form, staged_data.next_id);
		seed_data = staged_data.staged;
		seed_form = staged_form.staged;
		bag.deferred = [...staged_data.deferred, ...staged_form.deferred];
		bag.defer_next_id = staged_form.next_id; // real next id: never recomputed from the length
		bag.seed_reducers = seed_reducers; // resolve scripts encode with the same transport + defer
		scripts.push(`<script>${PAGE_DEFER_BOOTSTRAP}</script>`);
	} else if (has_pending) {
		// (data and form settle together, the request's wait: the visitor gone, nobody reads it)
		const settled = await settle_deferred(
			[shaped_data, page_snap.form],
			request_scope(bag.request),
			event?.url.pathname
		);
		if (settled === STALE) return STALE;
		[seed_data, seed_form] = settled as [typeof seed_data, typeof seed_form];
	}

	// The tail goes out after the defer bootstrap, before the seed.
	if (tail_html) scripts.push(tail_html);

	// THE LANE: a JSON-exact slice (the common CMS tree, no promise staged into it) goes out as
	// native `JSON.stringify` output; anything devalue exists for keeps devalue.
	const payload = event
		? PageSeed.serialize(
				{
					url: event.url,
					params: event.params,
					route: event.route,
					status: page_snap.status ?? 200,
					data: seed_data,
					form: seed_form,
					error: page_snap.error
				},
				seed_stringify,
				!has_pending && data_shape.json && form_shape.json && analyze(page_snap.error ?? null).json
			)
		: null;
	if (payload)
		scripts.push(
			ogygia_script(
				'page',
				payload.text,
				`${OGYGIA_PAGE}${payload.json ? ` ${OG_FORMAT}="${WIRE_FORMAT_JSON}"` : ''}${mark_attr(bag.request)}${RULES ? unshipped_attr(page_snap.data, keys) : ''}`
			)
		);
	return { payload, tail_html, data: seed_data, keys };
}

/**
 * True when a remote's resolved value (deep) contains a region carrying baked SSR HTML: a
 * page-sized render, not seed data (see the skip in {@link remote_seed_script}). Depth-capped: a
 * region ticket sits shallow in any sane payload (a DocView's `entry.body` is 2 levels deep).
 */
export function has_baked_region(value: unknown, depth = 0): boolean {
	if (depth > 6 || value === null || typeof value !== 'object') return false;
	const r = value as Record<PropertyKey, unknown>;
	if (r[REGION_BRAND] === true && typeof r.html === 'string') return true;
	if (Array.isArray(value)) return value.some((x) => has_baked_region(x, depth + 1));
	for (const k in r) if (has_baked_region(r[k], depth + 1)) return true;
	return false;
}

/** The remote seed: the remote queries Kit resolved during the render, as one
 *  `<script type="application/ogygia-remote">`, or null when none ships. */
export async function remote_seed_script(
	state: RequestState,
	/** REMOTE SEED ONLY WHEN REACHABLE: the id-hashes some region's client on this page can call
	 *  (`bag.remotes_wanted`); `null` = unknown → seed every implicit remote (the pre-gate rule). */
	wanted: ReadonlySet<string> | null = null,
	/** the request whose response carries it: its mark goes on the script (RESPONSE-MARK) */
	request?: Request
): Promise<string | null> {
	const implicit = state.remote?.implicit;
	if (!implicit) return null;

	// The bucketing (Kit parity: q / p / l / f, `create_remote_key` keys) and the skips (private
	// remote, no region's client can call it (`wanted`), errored/pending, baked-region value) live
	// in server/remote-seed-gate.ts, pure and unit-tested; this serializes what comes back.
	const data = await collect_remote_seed(implicit, wanted, {
		memo: (internals) => state.remote.data?.get(internals as never),
		skip_value: (v) => has_baked_region(v),
		key: create_remote_key
	});

	if (!Object.values(data).some((b) => Object.keys(b).length > 0)) return null;

	const reducers = Object.fromEntries(
		Object.entries(app_transport).map(([name, codec]) => [name, codec.encode])
	);
	// devalue output is `<`-safe by itself (it writes `<`), so no second pass over the payload.
	return ogygia_script(
		'remote',
		devalue.stringify(data, reducers),
		request ? `${RESPONSE_MARK}="${response_mark(request)}"` : ''
	);
}
