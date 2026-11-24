/**
 * What `<Img>` asks of the plugin at render: a preset by name, and a file's URL. A preset the source
 * was warmed with names the static files the build made, on the server and in the browser alike. Any
 * other file is a signed URL on the server (the image server realm's minter); in the browser nothing
 * can sign, so a render that only happens there shows the original file. An island keeps the
 * server's URLs (`<Img>` reads them back from the page).
 *
 * @packageDocumentation
 */
import config from 'virtual:ogygia-image/config';
import type { ImagePreset } from './config.ts';
import type { ImageDescriptor } from './descriptor.ts';
import { lay_out, preset_request, same_files, type Laid, type LayoutRequest } from './layout.ts';
import { mint, warm_url, type Recipe } from './recipe.ts';
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
	const req = preset_request(p, own);
	const warmed =
		config.warmed &&
		preset !== undefined &&
		of.warm?.includes(preset) === true &&
		same_files(req, preset_request(p));
	return lay_out(of, req, config, (recipe) =>
		warmed ? warm_url(config.paths, recipe) : file_url(of, recipe)
	);
}
