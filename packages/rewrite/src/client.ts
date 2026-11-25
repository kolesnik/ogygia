/**
 * The rewrite plugin's browser realm (named by `rewrite()`): what the page needs around the restorer.
 * A document a rewrite restored something in carries the restorer inline (`__og_restore`,
 * `__og_restore_adopt`); a page that has none yet loads this realm's copy at boot, a chunk of its
 * own (the boot carries none of it), for the region answers it fetches: an answer parsed before the
 * copy is in waits for it. This realm reports what the restorer recorded, restores each region
 * answer before anything reads it, and keeps a web component's own class tokens through Svelte's
 * hydrate.
 */
import { defineClient, type ClientPlugin, type PageGlobals } from '@ogygia/core/plugin/client';
import { keep_host_classes, note_host_classes } from './host-classes.ts';
import { report_restores } from './restore-report.ts';

function load_restorer(w: PageGlobals): Promise<void> {
	return import('./restore.ts').then(
		({ restore, restore_adopt }) => {
			w.__og_restore ??= restore as NonNullable<PageGlobals['__og_restore']>;
			w.__og_restore_adopt ??= restore_adopt;
		},
		(error: unknown) =>
			void import('./messages.ts').then(
				({ OgygiaError }) => console.error(new OgygiaError('restorer_unloaded'), error),
				() => console.error(error)
			)
	);
}

const client: ClientPlugin = defineClient({
	boot({ kitPage }) {
		const w = window as PageGlobals;
		// (a Kit-hydrated page: ogygia's runtime does not boot there, so it never reported either)
		const report = () => {
			if (!kitPage) report_restores();
		};
		if (w.__og_restore) return report();
		w.__og_restore_ready = load_restorer(w).then(report);
	},
	hooks: {
		regionHydrate({ el }) {
			const noted = note_host_classes(el);
			return noted ? () => keep_host_classes(noted) : undefined;
		},
		answerParsed({ fragment }) {
			// (the page's restorer, read now: the report wraps it at boot)
			const w = window as PageGlobals;
			if (!w.__og_restore) {
				return w.__og_restore_ready?.then(() => {
					w.__og_restore?.(fragment);
				});
			}
			w.__og_restore(fragment);
		},
		answerPlaced() {
			(window as PageGlobals).__og_restore_adopt?.();
		}
	}
});
export default client;
