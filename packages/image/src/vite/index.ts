/**
 * `image()`: images for an ogygia app, listed beside `ogygia()`
 * (`plugins: [ogygia(), image(), sveltekit()]`).
 *
 *   const hero = import.meta.og.image('./hero.jpg');   // → an ImageDescriptor
 *   <Img of={hero} alt="…" />                           // from '@ogygia/image'
 *
 * - The macro (./macro.ts) turns each call into an import of the file under the `og-image` query.
 * - `load` turns that import into the descriptor. At build every variant is encoded (kept in the build
 *   cache) and imported as an asset, so Vite names, hashes and ships it like any other. In dev nothing
 *   is encoded up front: the variants point at `/@og-image/…`, encoded on first request.
 * - With `@ogygia/content`, markdown images and frontmatter image paths become descriptors too
 *   (./markdown.ts).
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin as VitePlugin, ResolvedConfig } from 'vite';
import { definePlugin, type OgygiaPlugin } from '@ogygia/compiler/vite';
import type { ImageDescriptor } from '../descriptor.ts';
import { mime_of } from '../layout.ts';
import { plan_image, settle, write_variant, type Plan, type Settings } from './encode.ts';
import { install_markdown_bridge } from './markdown.ts';
import { rewrite_image_calls, options_of_query, QUERY } from './macro.ts';
import { check_image_options, check_plugin_options, type ImagePluginOptions } from './options.ts';

export type { ImageOps, ImageOptions, ImagePluginOptions, OutputFormat } from './options.ts';

const QUERY_RE = new RegExp(`[?&]${QUERY}(?:=|&|$)`);
const DEV_PREFIX = '@og-image/';

/** A dev variant: what the dev route encodes when its URL is asked for. */
type DevEntry = { file: string; plan: Plan; settings: Settings };

/** The image plugin. */
export function image(options?: ImagePluginOptions): VitePlugin[] {
	const opts = check_plugin_options(options);
	let config: ResolvedConfig | undefined;
	const dev = new Map<string, DevEntry>();
	install_markdown_bridge(opts);

	const ogygia: OgygiaPlugin = definePlugin({
		name: '@ogygia/image',
		build(b) {
			b.macro('image', (code, m) => rewrite_image_calls(code, m.id, m.markupExts));
		}
	});

	const base = (): string => {
		const b = config?.base ?? '/';
		return b.startsWith('/') ? (b.endsWith('/') ? b : `${b}/`) : '/';
	};

	const loader: VitePlugin = {
		name: '@ogygia/image:load',
		enforce: 'pre',
		configResolved(c) {
			config = c;
		},
		async load(id) {
			const q = id.indexOf('?');
			if (q === -1 || !QUERY_RE.test(id.slice(q))) return null;
			const file = id.slice(0, q);
			const own = check_image_options(path.basename(file), options_of_query(id.slice(q + 1)));
			const settings = settle(opts, own);
			this.addWatchFile(file);
			const plan = await plan_image(file, settings);
			const descriptor: Omit<ImageDescriptor, 'variants'> = {
				id: plan.id,
				width: plan.width,
				height: plan.height,
				...(plan.ph ? { ph: plan.ph } : {}),
				...(plan.animated ? { animated: true } : {})
			};
			const head = JSON.stringify(descriptor).slice(0, -1);
			if (config?.command === 'serve') {
				const variants = plan.variants.map((v) => {
					const key = `${plan.id}/${v.name}`;
					dev.set(key, { file, plan, settings });
					return { src: `${base()}${DEV_PREFIX}${key}`, format: v.format, width: v.width };
				});
				return `export default ${head},"variants":${JSON.stringify(variants)}};\n`;
			}
			const paths = await Promise.all(
				plan.variants.map((v) => write_variant(file, plan, v, settings))
			);
			const imports = paths.map(
				(p, i) => `import __v${i} from ${JSON.stringify(`${p}?no-inline`)};`
			);
			const variants = plan.variants.map(
				(v, i) => `{"src":__v${i},"format":${JSON.stringify(v.format)},"width":${v.width}}`
			);
			return `${imports.join('\n')}\nexport default ${head},"variants":[${variants.join(',')}]};\n`;
		},
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const url = req.url ?? '';
				const at = url.indexOf(`/${DEV_PREFIX}`);
				if (at === -1) return next();
				const key = decodeURIComponent(url.slice(at + DEV_PREFIX.length + 1).split('?')[0]!);
				const entry = dev.get(key);
				const variant = entry?.plan.variants.find((v) => `${entry.plan.id}/${v.name}` === key);
				if (!entry || !variant) {
					res.statusCode = 404;
					res.end();
					return;
				}
				write_variant(entry.file, entry.plan, variant, entry.settings).then(
					(out) => {
						res.setHeader('content-type', mime_of(variant.format));
						// the path holds the content hash: a change is a new URL
						res.setHeader('cache-control', 'public, max-age=31536000, immutable');
						fs.createReadStream(out).pipe(res);
					},
					(e: unknown) => next(e)
				);
			});
		}
	};

	return [ogygia, loader];
}
