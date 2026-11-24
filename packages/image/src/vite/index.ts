/**
 * `image()`: images for an ogygia app, listed beside `ogygia()`
 * (`plugins: [ogygia(), image({ presets }), sveltekit()]`).
 *
 *   const hero = import.meta.og.image('./hero.jpg');   // → an ImageDescriptor (a SOURCE)
 *   <Img of={hero} preset="cover" alt="…" />            // from '@ogygia/image'
 *
 * Three moments:
 * - COMPILE: the macro (./macro.ts) turns each call into an import of the file under the `og-image`
 *   query; `load` turns that into the source's descriptor: its id, size, placeholder, and the
 *   original shipped as an ordinary asset. Nothing is encoded.
 * - RENDER: `<Img>` picks the files from the layout or preset and signs one URL per file (../server.ts).
 * - SETTLE: the server realm's endpoint makes each file on first request: in dev, in Kit's prerender
 *   (saved as a static file) and on a live server.
 *
 * With `@ogygia/content`, markdown images and frontmatter image paths become descriptors too
 * (./markdown.ts).
 *
 * @packageDocumentation
 */
import path from 'node:path';
import type { Plugin as VitePlugin, ResolvedConfig } from 'vite';
import { definePlugin, type OgygiaPlugin } from '@ogygia/compiler/vite';
import type { ImageDescriptor } from '../descriptor.ts';
import { DEFAULT_BREAKPOINTS, DEFAULT_FORMATS, type RenderConfig } from '../config.ts';
import { OgygiaError } from '../messages.ts';
import { plan_image, settle } from './plan.ts';
import { EXTENSION_API, markdown_extension } from './markdown.ts';
import { image_call_edits, options_of_query, QUERY } from './macro.ts';
import { check_image_options, check_plugin_options, type ImagePluginOptions } from './options.ts';

export type {
	ImageLayout,
	ImageOps,
	ImageOptions,
	ImagePluginOptions,
	ImagePosition,
	ImagePreset,
	OutputFormat
} from './options.ts';

const QUERY_RE = new RegExp(`[?&]${QUERY}(?:=|&|$)`);
const CONFIG_ID = 'virtual:ogygia-image/config';
const SOURCES_ID = 'virtual:ogygia-image/sources';
const RASTER_GLOB = '/src/**/*.{png,PNG,jpg,JPG,jpeg,JPEG,webp,WEBP,avif,AVIF,gif,GIF,tif,TIF,tiff,TIFF}';

/** The render settings `<Img>` reads, from the plugin's options. */
export function render_config(opts: ImagePluginOptions): RenderConfig {
	return {
		formats: opts.formats ?? DEFAULT_FORMATS,
		breakpoints: opts.breakpoints ?? DEFAULT_BREAKPOINTS,
		...(opts.quality !== undefined ? { quality: opts.quality } : {}),
		presets: opts.presets ?? {}
	};
}

/** The descriptor module of one source: its original imported as an asset, its plan as data. */
export function descriptor_module(
	file: string,
	plan: Omit<ImageDescriptor, 'src' | 'alt'>
): string {
	const data = JSON.stringify(plan).slice(1, -1);
	return [
		`import __src from ${JSON.stringify(`${file}?no-inline`)};`,
		`export default {"src":__src,${data}};`,
		''
	].join('\n');
}

/** The image plugin. */
export function image(options?: ImagePluginOptions): VitePlugin[] {
	const opts = check_plugin_options(options);
	let config: ResolvedConfig | undefined;
	const markdown = markdown_extension(opts);

	const ogygia: OgygiaPlugin = definePlugin({
		name: '@ogygia/image',
		server: import.meta.resolve('../server.ts'),
		build(b) {
			b.macro('image', (code, m) => image_call_edits(code, m.id, m.markupExts, m.watch));
		}
	});

	const loader: VitePlugin = {
		name: '@ogygia/image:load',
		enforce: 'pre',
		...(markdown ? { api: { [EXTENSION_API]: markdown } } : {}),
		config: () => ({ optimizeDeps: { exclude: ['@ogygia/image'] } }),
		configResolved(c) {
			config = c;
		},
		resolveId(id) {
			if (id === CONFIG_ID || id === SOURCES_ID) return `\0${id}`;
			return null;
		},
		async load(id) {
			if (id === `\0${CONFIG_ID}`) return `export default ${JSON.stringify(render_config(opts))};\n`;
			if (id === `\0${SOURCES_ID}`)
				return `export default import.meta.glob(${JSON.stringify(RASTER_GLOB)}, { query: '?no-inline', import: 'default', eager: true });\n`;
			const q = id.indexOf('?');
			if (q === -1 || !QUERY_RE.test(id.slice(q))) return null;
			const file = id.slice(0, q);
			const own = check_image_options(path.basename(file), options_of_query(id.slice(q + 1)));
			if (config) {
				const src = path.join(config.root, 'src') + path.sep;
				if (!file.startsWith(src))
					throw new OgygiaError('image_outside_src', {
						file: path.relative(config.root, file),
						src: path.relative(config.root, src)
					});
			}
			const settings = settle(opts, own);
			this.addWatchFile(file);
			const plan = await plan_image(file, settings);
			return descriptor_module(file, {
				id: plan.id,
				width: plan.width,
				height: plan.height,
				format: plan.format,
				...(plan.ph ? { ph: plan.ph } : {}),
				...(plan.animated ? { animated: true } : {}),
				...(settings.quality !== undefined ? { quality: settings.quality } : {}),
				...(Object.keys(settings.ops).length ? { ops: settings.ops } : {})
			});
		}
	};

	return [ogygia, loader];
}
