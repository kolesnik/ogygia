/**
 * What `<Img>` asks of the plugin at render: a preset by name, and a file's URL. On the server the URL
 * is signed (the image server realm's minter); in the browser nothing can sign, so a render that only
 * happens there shows the original file. An island's first render keeps the server's URLs (Svelte
 * does not touch `src` / `srcset` while hydrating).
 *
 * @packageDocumentation
 */
import config from 'virtual:ogygia-image/config';
import type { ImagePreset } from './config.ts';
import type { ImageDescriptor } from './descriptor.ts';
import { lay_out, type Laid, type LayoutRequest } from './layout.ts';
import { mint, type Recipe } from './recipe.ts';
import { RenderError } from './render-messages.ts';

const NONE: ImagePreset = {};

/** The preset `image({ presets })` names `name`, or none when no name is given. */
export function preset_of(name: string | undefined): ImagePreset {
	if (name === undefined) return NONE;
	const p = config.presets[name];
	if (p) return p;
	throw new RenderError('image_preset_unknown', {
		preset: name,
		known: Object.keys(config.presets).join(', ') || '(none)'
	});
}

/** The URL of one file of `of`. */
export function file_url(of: ImageDescriptor, recipe: Recipe): string {
	const url = mint(recipe);
	if (url !== null) return url;
	if (typeof window === 'undefined') throw new RenderError('image_no_server');
	return of.src;
}

/** What {@link layOut} takes: a preset by name, and anything to say over it. */
export interface LayOutRequest extends LayoutRequest {
	preset?: string;
}

/**
 * Lay out an image outside `<Img>` (a CSS background, an `og:image`, a hand-written `<picture>`): the
 * same files, signed URLs and attributes `<Img>` would render, from a preset or a layout. On the
 * server only, like `<Img>`'s own render.
 */
export function layOut(of: ImageDescriptor, request: LayOutRequest = {}): Laid {
	const { preset, ...own } = request;
	const p = preset_of(preset);
	return lay_out(
		of,
		{
			layout: own.layout ?? p.layout,
			width: own.width ?? p.width,
			height: own.height ?? p.height,
			aspect: own.aspect ?? p.aspect,
			position: own.position ?? p.position,
			sizes: own.sizes ?? p.sizes,
			quality: own.quality ?? p.quality,
			formats: own.formats ?? p.formats
		},
		config,
		(recipe) => file_url(of, recipe)
	);
}
