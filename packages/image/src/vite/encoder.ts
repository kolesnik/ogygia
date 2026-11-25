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
import { decisions, type Decisions } from '@ogygia/machine';
import { OgygiaError, warn } from '../messages.ts';

/** Who makes an app's image files, and what URL names each: plain data from a factory
 *  (`sharp()`), for `image({ encoder })`. */
export interface Encoder {
	/** Which encoder it is. */
	readonly name: 'sharp';
	/** What its own links can make without the app's endpoint, or null: every live file goes
	 *  through the endpoint. */
	readonly links: null;
	/** What makes its files at the app's endpoint, or null: nothing in that runtime. */
	readonly maker: 'sharp' | null;
	/** Whether a CDN picks each file's format from the browser's `Accept` (one URL per width). */
	readonly negotiates: boolean;
	/** The widths it makes: any, or only these. */
	readonly widths: 'any' | readonly number[];
}

/** sharp (the default): the app's own endpoint makes every live file, in dev and on a Node server,
 *  and the build every file a prerendered page names. */
export function sharp(): Encoder {
	return { name: 'sharp', links: null, maker: 'sharp', negotiates: false, widths: 'any' };
}

const SHARP: Encoder = sharp();

/** The encoders `image({ encoder })` lists, in order: `sharp()` when it lists none. */
export function encoders_of(encoder: Encoder | readonly Encoder[] | undefined): readonly Encoder[] {
	if (encoder === undefined) return [SHARP];
	return Array.isArray(encoder) ? encoder : [encoder as Encoder];
}

/** The maker of `encoders`: the first that has one, or null. */
export function maker_of(encoders: readonly Encoder[]): Encoder['maker'] {
	return encoders.find((e) => e.maker !== null)?.maker ?? null;
}

function file_of(url: string): string {
	return fileURLToPath(url).split(path.sep).join('/');
}

const MAKERS: Readonly<Record<NonNullable<Encoder['maker']> | 'none', string>> = {
	sharp: file_of(import.meta.resolve('../makers/sharp.ts')),
	none: file_of(import.meta.resolve('../makers/none.ts'))
};
const ENDPOINT_NAMER: string = file_of(import.meta.resolve('../namers/endpoint.ts'));

/** The source of `virtual:ogygia-image/maker` for `encoders`. */
export function maker_module(encoders: readonly Encoder[]): string {
	return `export * from ${JSON.stringify(MAKERS[maker_of(encoders) ?? 'none'])};\n`;
}

/** The source of `virtual:ogygia-image/namer` for `encoders`: no encoder has links yet, so every
 *  live file is the endpoint's. */
export function namer_module(): string {
	return `export * from ${JSON.stringify(ENDPOINT_NAMER)};\n`;
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
	maker: 'sharp' | 'none';
	installed: boolean;
	listed: 'none' | 'dev' | 'dependencies';
}

/** What a config's sharp calls for: go on, warn that the server cannot encode, or fail. */
export const ENCODER: Decisions<EncoderInput, 'ok' | 'edge' | 'missing' | 'unlisted'> = decisions({
	name: 'image encoder',
	inputs: {
		runtime: ['dev', 'client', 'prerendered', 'server', 'edge'],
		maker: ['sharp', 'none'],
		installed: [false, true],
		listed: ['none', 'dev', 'dependencies']
	},
	decide: (i: EncoderInput): 'ok' | 'edge' | 'missing' | 'unlisted' => {
		if (!i.installed || i.listed === 'none') return 'missing';
		if (i.maker === 'none') return 'ok';
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

/** Check the app's sharp for `runtime` and the endpoint's `maker`: throws `image_sharp_missing`, or
 *  warns `image_adapter_no_encoder` for an adapter whose runtime cannot load it. */
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
	if (plan === 'edge') warn('image_adapter_no_encoder', { adapter: adapter ?? 'this adapter' });
	else if (plan !== 'ok')
		throw new OgygiaError('image_sharp_missing', { adapter, installed: plan === 'unlisted' });
}
