/**
 * The check that Vercel can make every link `vercel()` names: after adapter-vercel writes
 * `.vercel/output/config.json` (Kit runs the adapter in its server build's `closeBundle`; this
 * plugin's runs after it), its `images` must allow every width and quality the encoder names, every
 * format the plugin asks for, and the host of an absolute `paths.assets`. Vercel answers a link
 * outside them with an error, so a gap fails the build (`image_vercel_config`), with the exact
 * `images` value to pass.
 *
 * @packageDocumentation
 */
import fs from 'node:fs';
import path from 'node:path';
import type { Plugin as VitePlugin, ResolvedConfig } from 'vite';
import type { OutputFormat } from '../config.ts';
import { OgygiaError } from '../messages.ts';
import type { Encoder, VercelImages } from './encoder.ts';

/** What the build names that Vercel must allow. */
export interface VercelWant {
	/** The images `vercel()` hands the adapter. */
	images: VercelImages;
	/** Every format the plugin and its presets ask for. */
	formats: readonly OutputFormat[];
	/** Kit's `paths.assets` (a full URL names a host Vercel must fetch from). */
	assets: string;
}

interface RemotePattern {
	hostname?: unknown;
}

/** What `have` (the output's `images`) lacks of `want`, one entry each, or none. */
export function vercel_config_missing(have: unknown, want: VercelWant): string[] {
	if (have === null || typeof have !== 'object') return ['images (no images config at all)'];
	const h = have as Partial<Record<'sizes' | 'qualities' | 'formats' | 'domains', unknown[]>> & {
		remotePatterns?: RemotePattern[];
	};
	const out: string[] = [];
	const sizes = h.sizes ?? [];
	for (const s of want.images.sizes) if (!sizes.includes(s)) out.push(`sizes ${s}`);
	if (h.qualities !== undefined) {
		if (want.images.qualities === undefined)
			out.push('qualities (any 1–100: vercel() names no qualities, but images lists some)');
		else
			for (const q of want.images.qualities)
				if (!h.qualities.includes(q)) out.push(`qualities ${q}`);
	}
	const formats = h.formats ?? ['image/webp'];
	for (const f of want.formats)
		if ((f === 'avif' || f === 'webp') && !formats.includes(`image/${f}`))
			out.push(`formats image/${f}`);
	if (/^https?:\/\//.test(want.assets)) {
		const host = new URL(want.assets).hostname;
		const listed =
			(h.domains ?? []).includes(host) ||
			(h.remotePatterns ?? []).some(
				(p) => typeof p.hostname === 'string' && new RegExp(p.hostname).test(host)
			);
		if (!listed) out.push(`remote host ${host}`);
	}
	return [...new Set(out)];
}

const OUTPUT_CONFIG = '.vercel/output/config.json';

/** The plugin that checks the adapter's output once Kit's adapter ran, in a server build that lists
 *  `vercel()`. */
export function vercel_config_check(
	encoders: readonly Encoder[],
	want: () => Omit<VercelWant, 'images'>
): VitePlugin {
	const encoder = encoders.find((e) => e.name === 'vercel') as
		| (Encoder & { images: VercelImages })
		| undefined;
	let config: ResolvedConfig | undefined;
	let started = 0;
	return {
		name: '@ogygia/image:vercel-config',
		apply: 'build',
		configResolved(c) {
			config = c;
		},
		buildStart() {
			started = Date.now();
		},
		closeBundle: {
			order: 'post',
			sequential: true,
			handler() {
				if (!encoder || !config?.build.ssr) return;
				const named = config.define?.__SVELTEKIT_ADAPTER_NAME__;
				const adapter = typeof named === 'string' ? (JSON.parse(named) as string) : null;
				const file = path.resolve(OUTPUT_CONFIG);
				const line = `adapter({ images: ${JSON.stringify(encoder.images)} })`;
				const fail = (missing: string[], have: string): never => {
					throw new OgygiaError('image_vercel_config', { missing: missing.join(', '), have, line });
				};
				if (adapter !== '@sveltejs/adapter-vercel')
					fail(
						[`adapter-vercel (this app's adapter is ${adapter ?? 'none'})`],
						'no /_vercel/image'
					);
				if (!fs.existsSync(file) || fs.statSync(file).mtimeMs < started)
					fail([`${OUTPUT_CONFIG} written by this build`], 'no output config');
				const images = (JSON.parse(fs.readFileSync(file, 'utf8')) as { images?: unknown }).images;
				const missing = vercel_config_missing(images, { images: encoder.images, ...want() });
				if (missing.length) fail(missing, JSON.stringify(images ?? null));
			}
		}
	};
}
