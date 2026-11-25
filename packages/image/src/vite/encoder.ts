/**
 * The ENCODER: who makes an app's image files, and what URL names each. `image({ encoder })` takes
 * one or a list (default `sharp()`); the plugin turns it into two modules at build: the NAMER
 * (`virtual:ogygia-image/namer`, ../namers/: an encoder's own link of a live file, in the server and
 * in the browser) and the MAKER (`virtual:ogygia-image/maker`, ../makers/: what makes a file at the
 * app's endpoint, server only), so a bundle holds only the one it uses. A prerendered page's files
 * are always made by the build, with sharp, whatever the encoder.
 *
 * sharp is a peer the app installs. The build and the dev server load it on first use
 * ({@link pixels}), so the plugin's Vite entry loads in an app that never installed it, and
 * {@link check_encoder} says which line to add before any image is planned. Where sharp must be:
 * listed in the app's package.json and installed for every build and dev server; and, for a server
 * build whose maker is sharp, listed in the app's `dependencies`, the list adapter-node keeps out of
 * its bundle (sharp bundled cannot find its native binary, so every image would answer 500).
 *
 * @packageDocumentation
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { dedent } from '@ogygia/core/contract';
import { decisions, type Decisions } from '@ogygia/machine';
import { cannot } from '../encoders/capabilities.ts';
import { NEEDS, type Need } from '../encoders/needs.ts';
import { OgygiaError, warn } from '../messages.ts';
import type { NamerPlan } from '../namers/resolve.ts';

/** Who makes an app's image files, and what URL names each: plain data from a factory
 *  (`sharp()`, `cloudflare()`), for `image({ encoder })`. */
export interface Encoder {
	/** Which encoder it is. */
	readonly name: 'sharp' | 'cloudflare';
	/** What its own links can make without the app's endpoint, or null: every live file goes
	 *  through the endpoint. */
	readonly links: readonly Need[] | null;
	/** What makes its files at the app's endpoint, or null: nothing in that runtime. */
	readonly maker: 'sharp' | 'binding' | null;
	/** The Cloudflare Images binding its maker makes files with, or null. */
	readonly binding: string | null;
	/** Whether a CDN picks each file's format from the browser's `Accept` (one URL per width). */
	readonly negotiates: boolean;
	/** The widths it makes: any, or only these. */
	readonly widths: 'any' | readonly number[];
}

/** sharp (the default): the app's own endpoint makes every live file, in dev and on a Node server,
 *  and the build every file a prerendered page names. */
export function sharp(): Encoder {
	return {
		name: 'sharp',
		links: null,
		maker: 'sharp',
		binding: null,
		negotiates: false,
		widths: 'any'
	};
}

/** What `cloudflare()` takes. */
export interface CloudflareOptions {
	/** Name each file a page rendered on request shows as an Image Transformations link,
	 *  `/cdn-cgi/image/<options>/<original>`, made by Cloudflare's CDN (transformations must be on
	 *  for the zone). Default `true`. `false`: the app's endpoint makes each with the Images
	 *  binding. */
	links?: boolean;
	/** The Images binding the endpoint makes files with: the name the Worker's wrangler config
	 *  gives it (`"images": { "binding": "IMAGES" }`). Default `'IMAGES'`. */
	binding?: string;
}

const CLOUDFLARE_KEYS: ReadonlySet<string> = new Set(['links', 'binding']);
const BINDING_RE = /^[A-Za-z_$][\w$]*$/;

/** Cloudflare, for an app on Workers (adapter-cloudflare): a page rendered on request names its
 *  files as Image Transformations links, and what links cannot name (or every file, with
 *  `links: false`) the app's endpoint makes with the Worker's Images binding, kept in the Worker's
 *  cache. A prerendered page's files are made by the build, with sharp, as with any encoder. */
export function cloudflare(options: CloudflareOptions = {}): Encoder {
	const where = 'cloudflare()';
	if (options === null || typeof options !== 'object' || Array.isArray(options))
		throw new OgygiaError('image_option_invalid', { where, key: 'options', rule: 'an object' });
	for (const key of Object.keys(options))
		if (!CLOUDFLARE_KEYS.has(key))
			throw new OgygiaError('image_option_unknown', {
				where,
				key,
				known: [...CLOUDFLARE_KEYS].join(', ')
			});
	const { links = true, binding = 'IMAGES' } = options;
	if (typeof links !== 'boolean')
		throw new OgygiaError('image_option_invalid', { where, key: 'links', rule: 'a boolean' });
	if (typeof binding !== 'string' || !BINDING_RE.test(binding))
		throw new OgygiaError('image_option_invalid', {
			where,
			key: 'binding',
			rule: 'the name of a binding (letters, digits, _ and $, not starting with a digit)'
		});
	return {
		name: 'cloudflare',
		links: links ? NEEDS.filter((n) => !cannot('cloudflare').includes(n)) : null,
		maker: 'binding',
		binding,
		negotiates: false,
		widths: 'any'
	};
}

const SHARP: Encoder = sharp();

/** The encoders `image({ encoder })` lists, in order: `sharp()` when it lists none. */
export function encoders_of(encoder: Encoder | readonly Encoder[] | undefined): readonly Encoder[] {
	if (encoder === undefined) return [SHARP];
	return Array.isArray(encoder) ? encoder : [encoder as Encoder];
}

/** The encoder whose maker makes files at the endpoint: the first that has one, or none. */
function endpoint_of(encoders: readonly Encoder[]): Encoder | undefined {
	return encoders.find((e) => e.maker !== null);
}

/** The maker of `encoders`: the first that has one, or null. */
export function maker_of(encoders: readonly Encoder[]): Encoder['maker'] {
	return endpoint_of(encoders)?.maker ?? null;
}

function file_of(url: string): string {
	return fileURLToPath(url).split(path.sep).join('/');
}

const MAKERS: Readonly<Record<'sharp' | 'binding' | 'none', string>> = {
	sharp: file_of(import.meta.resolve('../makers/sharp.ts')),
	binding: file_of(import.meta.resolve('../makers/binding.ts')),
	none: file_of(import.meta.resolve('../makers/none.ts'))
};
const ENDPOINT_NAMER: string = file_of(import.meta.resolve('../namers/endpoint.ts'));
const RESOLVE_NAMER: string = file_of(import.meta.resolve('../namers/resolve.ts'));

/** The source of `virtual:ogygia-image/maker` for `encoders`. The dev server makes every file with
 *  sharp: no Worker binding runs there. */
export function maker_module(encoders: readonly Encoder[], dev: boolean): string {
	const e = endpoint_of(encoders);
	if (dev || e?.maker !== 'binding')
		return `export * from ${JSON.stringify(MAKERS[dev ? 'sharp' : (e?.maker ?? 'none')])};\n`;
	return dedent`
		import { binding_maker } from ${JSON.stringify(MAKERS.binding)};
		const maker = binding_maker(${JSON.stringify(e.binding)});
		export const parallel = maker.parallel;
		export const make = maker.make;
		export const store = maker.store;
	`;
}

/** How `encoders` name a recipe at render ({@link namer_module}). */
export function namer_plan(encoders: readonly Encoder[], dev: boolean): NamerPlan {
	const e = endpoint_of(encoders);
	return {
		encoders: encoders.map((x) => `${x.name}()`).join(', '),
		links: encoders
			.filter((x) => x.links !== null)
			.map((x) => ({
				kind: x.name as 'cloudflare',
				cannot: NEEDS.filter((n) => !x.links!.includes(n))
			})),
		endpoint: e === undefined ? null : cannot(e.name),
		dev
	};
}

/** The source of `virtual:ogygia-image/namer` for `encoders`: the endpoint's (it names nothing)
 *  when no encoder has links and the endpoint makes every need, else the plan's. */
export function namer_module(encoders: readonly Encoder[], dev: boolean): string {
	const plan = namer_plan(encoders, dev);
	if (!plan.links.length && plan.endpoint?.length === 0)
		return `export * from ${JSON.stringify(ENDPOINT_NAMER)};\n`;
	return dedent`
		import { namer } from ${JSON.stringify(RESOLVE_NAMER)};
		export const name = namer(${JSON.stringify(plan)});
	`;
}

/** The pixel module (sharp), loaded on first use. */
export function pixels(): Promise<typeof import('../pixels.ts')> {
	return import('../pixels.ts');
}

/** What runs the app this config builds or serves. */
export type EncoderRuntime = 'dev' | 'client' | 'prerendered' | 'server' | 'edge';

const STATIC_ADAPTER_RE = /^@sveltejs\/adapter-static$/;
const NO_NATIVE_ADAPTER_RE = /cloudflare|deno|-edge\b/i;

/** The runtime of a resolved config, or null where no image is planned (`vite preview`). */
export function encoder_runtime(
	command: 'build' | 'serve',
	ssr: boolean,
	preview: boolean,
	adapter: string | null
): EncoderRuntime | null {
	if (command === 'serve') return preview ? null : 'dev';
	if (!ssr) return 'client';
	if (adapter !== null && STATIC_ADAPTER_RE.test(adapter)) return 'prerendered';
	if (adapter !== null && NO_NATIVE_ADAPTER_RE.test(adapter)) return 'edge';
	return 'server';
}

/** What the encoder check reads: the runtime, the endpoint's maker (`none`: no encoder makes files
 *  there), and the app's sharp. */
export interface EncoderInput {
	runtime: EncoderRuntime;
	maker: 'sharp' | 'binding' | 'none';
	installed: boolean;
	listed: 'none' | 'dev' | 'dependencies';
}

/** What a config's sharp calls for: go on, warn that the server cannot encode, or fail. */
export const ENCODER: Decisions<EncoderInput, 'ok' | 'edge' | 'missing' | 'unlisted'> = decisions({
	name: 'image encoder',
	inputs: {
		runtime: ['dev', 'client', 'prerendered', 'server', 'edge'],
		maker: ['sharp', 'binding', 'none'],
		installed: [false, true],
		listed: ['none', 'dev', 'dependencies']
	},
	decide: (i: EncoderInput): 'ok' | 'edge' | 'missing' | 'unlisted' => {
		if (!i.installed || i.listed === 'none') return 'missing';
		if (i.maker !== 'sharp') return 'ok';
		if (i.runtime === 'edge') return 'edge';
		if (i.runtime === 'server' && i.listed !== 'dependencies') return 'unlisted';
		return 'ok';
	}
});

function in_node_modules(root: string): boolean {
	for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
		if (fs.existsSync(path.join(dir, 'node_modules', 'sharp', 'package.json'))) return true;
		if (path.dirname(dir) === dir) return false;
	}
}

function resolves(root: string): boolean {
	try {
		createRequire(path.join(root, 'package.json')).resolve('sharp');
		return true;
		// oxlint-disable-next-line ogygia/no-silent-failures -- not resolving is the answer: the caller throws image_sharp_missing
	} catch {
		return false;
	}
}

// @why require.resolve also reads NODE_PATH, which pnpm's bin shims point at its whole store and no deploy has (test: packages/image/test/encoder-check.test.ts › with NODE_PATH set, a sharp that Node finds with no node_modules folder at or above the app is not the app installing it)
function installed(root: string): boolean {
	if (!resolves(root)) return false;
	return !process.env.NODE_PATH || in_node_modules(root);
}

function listed(root: string): 'none' | 'dev' | 'dependencies' {
	const file = path.join(root, 'package.json');
	if (!fs.existsSync(file)) return 'none';
	const pkg = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
	const has = (field: string): boolean =>
		typeof (pkg[field] as Record<string, unknown> | undefined)?.sharp === 'string';
	if (has('dependencies')) return 'dependencies';
	return has('devDependencies') || has('optionalDependencies') ? 'dev' : 'none';
}

let said_edge = false;

/** Check the app's sharp for `runtime` and the endpoint's `maker`: throws `image_sharp_missing`, or
 *  warns `image_no_encoder` (once a process) for an adapter whose runtime cannot load it. */
export function check_encoder(
	root: string,
	runtime: EncoderRuntime,
	adapter: string | null,
	maker: Encoder['maker']
): void {
	const plan = ENCODER.decide({
		runtime,
		maker: maker ?? 'none',
		installed: installed(root),
		listed: listed(root)
	});
	if (plan === 'edge') {
		if (!said_edge)
			warn('image_no_encoder', {
				reason: `${adapter ?? 'this adapter'} runs the app where sharp, a native Node module, cannot load`
			});
		said_edge = true;
	} else if (plan !== 'ok')
		throw new OgygiaError('image_sharp_missing', { adapter, installed: plan === 'unlisted' });
}
