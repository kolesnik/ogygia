/**
 * Markdown extensions: what another Vite plugin adds to content's markdown pipeline without either
 * package importing the other. A plugin offers one on its Vite plugin object as
 * `api.ogygiaMarkdown`; `content()` reads the resolved plugin list and holds each offer in the
 * bridge, owned by that config, so a config that stops listing the plugin (or offers nothing) drops
 * it, and the preprocessor reads the live set on every compile.
 *
 * @packageDocumentation
 */
import { scope } from '@ogygia/machine';
import { bridge } from '../bridge.ts';
import { OgygiaError } from '../messages/build.ts';
import type { StagedPlugin } from './index.ts';

/** What a markdown extension's `finish` hands back. */
export interface MarkdownFinish {
	/** The compiled module, rewritten. */
	code: string;
	/** Module-script lines to add (imports, exports). */
	lines: string[];
	/** The body now renders a component or an expression: it is never emitted as a static region. */
	dynamic: boolean;
	/** Files the output names (an image a post shows): watched like the document's own, and a kept
	 *  compile of the document whose file is gone compiles again, so the extension's check runs. */
	files?: readonly string[];
}

/** A markdown extension another plugin offers (its Vite plugin's `api.ogygiaMarkdown`). */
export interface MarkdownExtension {
	/** Who offers it: one extension per name, the last config's. */
	name: string;
	/** What changes the compiled output besides the document and content's own settings: part of
	 *  the document cache key. Read on every compile. */
	cache_key: () => string;
	/** Rehype entries, staged like `markdown.rehype` (after the app's own entries of each stage). */
	rehype?: readonly StagedPlugin[];
	/** After mdsvex, before the island transform: rewrite the compiled module. */
	finish?: (code: string, filename: string) => MarkdownFinish;
}

/** The Vite plugin `api` key an extension is offered under. */
export const EXTENSION_API = 'ogygiaMarkdown';

function is_extension(value: unknown): value is MarkdownExtension {
	if (value === null || typeof value !== 'object') return false;
	const v = value as Record<string, unknown>;
	return (
		typeof v.name === 'string' &&
		typeof v.cache_key === 'function' &&
		(v.rehype === undefined || Array.isArray(v.rehype)) &&
		(v.finish === undefined || typeof v.finish === 'function')
	);
}

/** Hold the extensions `plugins` offer, under a new lifetime that ends the previous config's. */
export function hold_markdown_extensions(
	plugins: readonly { name?: string; api?: unknown }[]
): void {
	bridge.markdownExtensionsScope?.close();
	const life = (bridge.markdownExtensionsScope = scope());
	for (const p of plugins) {
		const offer = (p.api as Record<string, unknown> | undefined)?.[EXTENSION_API];
		if (offer === undefined) continue;
		if (!is_extension(offer))
			throw new OgygiaError('content_markdown_extension_invalid', { plugin: p.name ?? '?' });
		bridge.markdownExtensions.set(offer.name, offer, life);
	}
}

/** The extensions held now, in the order they were set. */
export function markdown_extensions(): MarkdownExtension[] {
	return [...bridge.markdownExtensions.values()];
}
