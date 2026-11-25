// The rewrite realm's work on every region hydrate (src/client.ts `regionHydrate`, src/host-classes.ts):
// each restored custom element's own class tokens noted before Svelte's hydrate and put back after
// it, over a page of 250 regions, a fifth of them holding a restored host (happy-dom stands in: its
// own DOM work counts too). A region with no restored host costs one walk of its elements.
import { Window } from 'happy-dom';
import { bench } from '@bench/heisenbench/bench';
import { keep_host_classes, note_host_classes, SVELTE_CLASS } from '../src/host-classes.ts';

const REGIONS = 250;

function page(): Element[] {
	const win = new Window({ url: 'http://x/' });
	const doc = win.document as unknown as Document;
	const regions: Element[] = [];
	for (let i = 0; i < REGIONS; i++) {
		const region = doc.createElement('ogygia-region');
		region.innerHTML =
			i % 5 === 0
				? '<x-card class="card own-a own-b"><p>title</p><span>body</span></x-card>'
				: '<div class="card"><p>title</p><span>body</span></div>';
		const host = region.querySelector('x-card');
		if (host) (host as unknown as Record<string, string>)[SVELTE_CLASS] = 'card';
		doc.body.append(region);
		regions.push(region);
	}
	return regions;
}

bench(
	'rewrite realm: a page of regions hydrates, each restored host’s own class tokens noted and kept',
	({ regions }) => {
		let kept = 0;
		for (const region of regions) {
			const noted = note_host_classes(region);
			// (Svelte's hydrate writes the host's class whole)
			if (noted) for (const [el] of noted) el.setAttribute('class', 'card');
			keep_host_classes(noted);
			if (noted) kept += noted.length;
		}
		return kept;
	},
	{ setup: () => ({ regions: page() }) }
);
