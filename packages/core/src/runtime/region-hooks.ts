import { regionMount } from 'ogygia:boot/hooks';

/** A region's component started in the browser: its entry, and the files it runs from. */
export function client_region_mount(el: Element): void {
	const entry = el.getAttribute('entry');
	if (!regionMount || !entry) return;
	regionMount({ el, entry, urls: region_urls(el, entry) });
}

function region_urls(el: Element, entry: string): string[] {
	const urls: string[] = [];
	for (const u of [entry, el.getAttribute('src')]) {
		try {
			if (u) urls.push(new URL(u, document.baseURI).href);
			// oxlint-disable-next-line ogygia/no-silent-failures -- not a URL, so not a script of the page
		} catch {}
	}
	return urls;
}
