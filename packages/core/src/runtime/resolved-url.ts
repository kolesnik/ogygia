import { lru } from '@ogygia/machine';

/** A URL as the URL parser read it: the parts the runtime compares and writes. */
export interface ResolvedUrl {
	readonly href: string;
	readonly origin: string;
	readonly protocol: string;
	readonly pathname: string;
	readonly search: string;
	readonly hash: string;
}

const PER_BASE = 4000;

/**
 * The runtime's one URL parse. A parse is pure, so each (base, url) pair is parsed once: a page's
 * island loads and preloads ask the same few hundred pairs again and again. The bases are the few
 * addresses the page has had (a navigation adds one); each keeps up to {@link PER_BASE} urls.
 */
export class ResolvedUrls {
	readonly #bases = lru<string, Map<string, ResolvedUrl | null>>({
		name: 'url bases',
		max: 16
	});
	#no_base: Map<string, ResolvedUrl | null> | null = null;

	/** `url` against `base` (the page's address when left out, none when `null`), or null when it
	 *  is not a URL. */
	resolve(url: string, base?: string | null): ResolvedUrl | null {
		const b = base === undefined ? location.href : base;
		let known = b === null ? (this.#no_base ??= new Map()) : this.#bases.get(b);
		if (known === undefined) this.#bases.set(b as string, (known = new Map()));
		const hit = known.get(url);
		if (hit !== undefined) return hit;
		let out: ResolvedUrl | null;
		try {
			const u = b === null ? new URL(url) : new URL(url, b);
			out = {
				href: u.href,
				origin: u.origin,
				protocol: u.protocol,
				pathname: u.pathname,
				search: u.search,
				hash: u.hash
			};
			// oxlint-disable-next-line ogygia/no-silent-failures -- not a URL: the caller's null case
		} catch {
			out = null;
		}
		if (known.size >= PER_BASE) known.clear();
		known.set(url, out);
		return out;
	}

	/** Test seam: forget every parse. */
	forget(): void {
		this.#bases.clear();
		this.#no_base = null;
	}
}

/** The runtime's parses. */
export const resolved_urls: ResolvedUrls = new ResolvedUrls();
