/**
 * A real server build drops a shared chunk's export whose last importer folded away, with the code
 * only it reached (link/dead-exports.ts, wired into the server leg's generateBundle); the client
 * build is left as the bundler wrote it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { build, type Rollup } from 'vite';
import { dedent } from '@ogygia/core/contract';
import { ogygia } from '../src/vite/index.ts';

let root = '';
afterEach(() => {
	if (root) fs.rmSync(root, { recursive: true, force: true });
	root = '';
});

function write(rel: string, text: string): void {
	const abs = path.join(root, rel);
	fs.mkdirSync(path.dirname(abs), { recursive: true });
	fs.writeFileSync(abs, text);
}

function app(): void {
	root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'og-dead-exports-build-')));
	write('package.json', JSON.stringify({ name: 'app', type: 'module' }));
	write('src/flag.ts', 'export const ON = 0;\n');
	write(
		'src/shared.ts',
		`${dedent`
			export function used() {
				return 'used';
			}
			function only_gated() {
				return 'only the gated helper reaches this';
			}
			export function gated() {
				return only_gated();
			}
		`}\n`
	);
	write(
		'src/a.ts',
		`${dedent`
			import { ON } from './flag.ts';
			import { used, gated } from './shared.ts';
			export const a = () => (ON & 1 ? gated() : used());
		`}\n`
	);
	write(
		'src/b.ts',
		`${dedent`
			import { used } from './shared.ts';
			export const b = used;
		`}\n`
	);
}

async function bundle(ssr: boolean): Promise<Map<string, string>> {
	const out = (await build({
		root,
		logLevel: 'silent',
		configFile: false,
		plugins: [...ogygia()],
		build: {
			write: false,
			minify: false,
			ssr,
			rolldownOptions: {
				input: [path.join(root, 'src/a.ts'), path.join(root, 'src/b.ts')],
				preserveEntrySignatures: 'strict'
			}
		}
	})) as Rollup.RolldownOutput;
	const files = new Map<string, string>();
	for (const item of out.output) if (item.type === 'chunk') files.set(item.fileName, item.code);
	return files;
}

describe('the dead-export pass in a real build', () => {
	it("a server build: the shared chunk's folded-away export goes, with the code only it reached", async () => {
		app();
		const files = await bundle(true);
		const all = [...files.values()].join('\n');
		expect(all).toContain('return "used"');
		expect(all).not.toContain('only the gated helper reaches this');
		expect(all).not.toMatch(/\bgated\b/);
	});

	it('a client build is left as the bundler wrote it', async () => {
		app();
		const all = [...(await bundle(false)).values()].join('\n');
		expect(all).toContain('only the gated helper reaches this');
	});
});
