import { untrack } from 'svelte';
import { island_graph_script, modulepreload_tag } from '#region-server';
import { graph_hrefs, location_of } from './locate.ts';
import type { IslandWire } from './island-wire.svelte.ts';
import type { RegionPlan } from './plan.svelte.ts';

/** The chunks an island's module needs, and how the page learns them: Kit's preload hints, the
 *  document tail's graph, or a graph script of its own in the head. */
export class IslandGraph {
	readonly #rp: RegionPlan;
	readonly #island: IslandWire;

	#live_locations: Map<string, string> | null | undefined = undefined;
	#hrefs: string[] | null = null;
	#kit_hints: string[] | null = null;
	#preload_head: string | null = null;

	/** Each live snippet entry's location, where the page's graph names one (null: none). Made at
	 *  its first read, as each of these is: a server render reads them for one region once. */
	get live_locations(): Map<string, string> | null {
		if (this.#live_locations !== undefined) return this.#live_locations;
		const live = this.#island.wire?.live_entries;
		let out: Map<string, string> | null = null;
		if (live?.length) {
			out = new Map();
			for (const m of live) {
				const loc = location_of(m);
				if (loc) out.set(m, loc);
			}
			if (!out.size) out = null;
		}
		return (this.#live_locations = out);
	}

	/** The chunks the island's module needs. */
	get hrefs(): string[] {
		return (this.#hrefs ??= !this.#island.module_url
			? []
			: graph_hrefs(this.#island.entry, this.#island.module_url, this.#island.wire?.live_entries));
	}

	/** Kit's preload hints, on a page Kit hydrates for an island waking at load. */
	get kit_hints(): string[] {
		return (this.#kit_hints ??=
			this.#rp.plan.csr && this.#island.wake.on === 'load' && this.#island.src
				? [this.#island.src, ...this.hrefs]
				: []);
	}

	/** The head's preloads, off Kit's pass (on it the graph goes to the tail). */
	get preload_head(): string {
		return (this.#preload_head ??= this.#rp.tail ? '' : this.#preload());
	}

	/** An island's graph in its place: on Kit's pass it goes to the page's tail. */
	constructor(rp: RegionPlan, island: IslandWire) {
		this.#rp = rp;
		this.#island = island;
		untrack(() => this.#record());
	}

	#record(): void {
		const tail = this.#rp.tail;
		if (!tail) return;
		const island = this.#island;
		const url = island.module_url;
		if (this.live_locations) for (const [m, loc] of this.live_locations) tail.locate(m, loc);
		if (this.kit_hints.length) tail.hints(this.kit_hints, island.fp);
		else if (!this.#rp.plan.csr && url) {
			const hrefs = tail.graph_of(url) ?? this.hrefs;
			if (hrefs.length) tail.graph(url, hrefs, island.fp, island.src);
		}
	}

	#preload(): string {
		if (this.kit_hints.length) return this.kit_hints.map(modulepreload_tag).join('');
		if (this.#rp.plan.csr || (!this.hrefs.length && !this.live_locations)) return '';
		return island_graph_script(
			new Map([[this.#island.module_url, this.hrefs]]),
			this.live_locations
		);
	}
}
