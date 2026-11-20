/**
 * Core's macros for a bench run. Heisenbench reads TypeScript from disk itself, so a core file with
 * macros is compiled (by `core_compile`, the config core's build and tests share) into a mirror of
 * the repository under `.heisenbench/macros/<mode>/`, and imports of it resolve to the mirror;
 * imports from the mirror resolve as from the source file. With `NODE_ENV=production` the mirror is
 * what an app's production build runs (`prod`); otherwise core's dist (`dev`). `unmirror`
 * (./unmirror.ts) names a report's mirror paths as the source files they compile.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { registerHooks } from 'node:module';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { MACRO_ROOTS, core_compile } from '../../../packages/core/macros.config.ts';

const REPO = fileURLToPath(new URL('../../../', import.meta.url));
const MODE = process.env.NODE_ENV === 'production' ? 'prod' : 'dev';
const MIRROR = join(REPO, '.heisenbench', 'macros', MODE);
const MIRROR_DIR = MIRROR + sep;
const SVELTE_RE = /\.svelte\.[cm]?ts$/;

const compiled = new Map<string, string | null>();

/** The mirror of a core source file with macros, or null when it has none (it loads as it is). */
export function mirrored(file: string): string | null {
	const known = compiled.get(file);
	if (known !== undefined) return known;
	let out: string | null = null;
	if (
		file.endsWith('.ts') &&
		!file.endsWith('.d.ts') &&
		!SVELTE_RE.test(file) &&
		MACRO_ROOTS.some((root) => file.startsWith(root))
	) {
		const code = readFileSync(file, 'utf8');
		const result = core_compile(code, file, MODE);
		if (result !== null && result.code !== code) {
			out = join(MIRROR, relative(REPO, file));
			mkdirSync(dirname(out), { recursive: true });
			writeFileSync(out, result.code);
		}
	}
	compiled.set(file, out);
	return out;
}

/** A mirror file's URL as the source file it compiles, keeping its query (a fresh module graph). */
function as_source(url: string): string {
	const at = url.indexOf('?');
	const path = fileURLToPath(at === -1 ? url : url.slice(0, at));
	return pathToFileURL(join(REPO, relative(MIRROR, path))).href + (at === -1 ? '' : url.slice(at));
}

/** Points imports of a core file with macros at its mirror (call once, in the bench preload). */
export function register_macro_mirror(): void {
	registerHooks({
		resolve(specifier, context, next) {
			const parent = context.parentURL;
			const r = next(
				specifier,
				parent?.startsWith('file:') && fileURLToPath(parent).startsWith(MIRROR_DIR)
					? { ...context, parentURL: as_source(parent) }
					: context
			);
			if (!r.url.startsWith('file:')) return r;
			const at = r.url.indexOf('?');
			const to = mirrored(fileURLToPath(at === -1 ? r.url : r.url.slice(0, at)));
			if (to === null) return r;
			return { ...r, url: pathToFileURL(to).href + (at === -1 ? '' : r.url.slice(at)) };
		}
	});
}

/** `files` (repository paths) as a run loads them: a core file with macros as its mirror, the code
 *  a bench counts and core's tests (its vitest macros) run, so an inventory of them names each
 *  function as their reports do: `$rules(function f …)` is `f`, a maker call the build checked sits
 *  in `trusted_<maker>:0`. */
export function as_run(files: readonly string[]): string[] {
	return files.map((f) => {
		const to = mirrored(join(REPO, f));
		return to === null ? f : relative(REPO, to);
	});
}

/** The files of another checkout (`files`, repository paths under `root`) made the form a run
 *  loads, in place, as {@link as_run} names this checkout's: each core file with macros compiled.
 *  The files this checkout's macros cannot compile stay as written, and are returned. */
export function compile_as_run(root: string, files: readonly string[]): string[] {
	const kept: string[] = [];
	for (const f of files) {
		const file = join(REPO, f);
		if (SVELTE_RE.test(file) || !file.endsWith('.ts') || file.endsWith('.d.ts')) continue;
		if (!MACRO_ROOTS.some((r) => file.startsWith(r))) continue;
		const at = join(root, f);
		const code = readFileSync(at, 'utf8');
		let result: ReturnType<typeof core_compile>;
		try {
			result = core_compile(code, file, MODE);
		} catch (error) {
			kept.push(`${f}: ${(error as Error).message.split('\n')[0]}`);
			continue;
		}
		if (result !== null && result.code !== code) writeFileSync(at, result.code);
	}
	return kept;
}
