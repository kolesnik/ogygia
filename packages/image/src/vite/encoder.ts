/**
 * The encoder, sharp: a peer the app installs. The build and the dev server load it on first use
 * ({@link pixels}), so the plugin's Vite entry loads in an app that never installed it, and
 * {@link check_encoder} says which line to add before any image is planned.
 *
 * Where sharp must be: listed in the app's package.json and installed for every build and dev
 * server; and, for a server build whose output makes files on request, listed in the app's
 * `dependencies`, the list adapter-node keeps out of its bundle (sharp bundled cannot find its
 * native binary, so every image would answer 500).
 *
 * @packageDocumentation
 */
import fs from 'node:fs';
import path from 'node:path';
import { decisions, type Decisions } from '@ogygia/machine';
import { OgygiaError, warn } from '../messages.ts';

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

/** What the encoder check reads: the runtime, and the app's sharp. */
export interface EncoderInput {
	runtime: EncoderRuntime;
	installed: boolean;
	listed: 'none' | 'dev' | 'dependencies';
}

/** What a config's sharp calls for: go on, warn that the server cannot encode, or fail. */
export const ENCODER: Decisions<EncoderInput, 'ok' | 'edge' | 'missing' | 'unlisted'> = decisions({
	name: 'image encoder',
	inputs: {
		runtime: ['dev', 'client', 'prerendered', 'server', 'edge'],
		installed: [false, true],
		listed: ['none', 'dev', 'dependencies']
	},
	decide: (i: EncoderInput): 'ok' | 'edge' | 'missing' | 'unlisted' => {
		if (!i.installed || i.listed === 'none') return 'missing';
		if (i.runtime === 'edge') return 'edge';
		if (i.runtime === 'server' && i.listed !== 'dependencies') return 'unlisted';
		return 'ok';
	}
});

// @why require.resolve also reads NODE_PATH, which pnpm's bin shims point at its whole store and no deploy has (test: packages/image/test/encoder-check.test.ts › a node server build fails, coded, when the app does not install sharp itself)
function installed(root: string): boolean {
	for (let dir = path.resolve(root); ; dir = path.dirname(dir)) {
		if (fs.existsSync(path.join(dir, 'node_modules', 'sharp', 'package.json'))) return true;
		if (path.dirname(dir) === dir) return false;
	}
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

/** Check the app's sharp for `runtime`: throws `image_sharp_missing`, or warns
 *  `image_adapter_no_encoder` for an adapter whose runtime cannot load it. */
export function check_encoder(root: string, runtime: EncoderRuntime, adapter: string | null): void {
	const plan = ENCODER.decide({ runtime, installed: installed(root), listed: listed(root) });
	if (plan === 'edge') warn('image_adapter_no_encoder', { adapter: adapter ?? 'this adapter' });
	else if (plan !== 'ok')
		throw new OgygiaError('image_sharp_missing', { adapter, installed: plan === 'unlisted' });
}
