/**
 * Generated modules: readable code a person reviews, written beside the sources they come from
 * (the files the generator owns are the ones its `owned` test names), or checked against what is
 * on disk (a stale or missing file fails the check). Only build output may be unreadable; what is
 * generated is formatted as the repository formats its own code.
 *
 * @packageDocumentation
 */
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync
} from 'node:fs';
import { dirname, join, sep } from 'node:path';

/** A generated module: where it goes, under the root, and what it holds. */
export interface Module {
	readonly path: string;
	readonly code: string;
}

/** How generated modules are written. */
export interface WriteOptions {
	/** Only say which differ; write nothing. */
	readonly check: boolean;
	/** Which files under the root the generator owns, by their path there (`a/+trait.gen.ts`): one
	 *  it owns but no longer makes is stale. */
	readonly owned?: (path: string) => boolean;
	/** The repository's formatting of every module at once, applied before comparing and
	 *  writing. */
	readonly format?: (codes: ReadonlyArray<string>) => ReadonlyArray<string>;
}

/** The modules that differ from what is on disk, by path; without `check`, written first. */
export function writeGenerated(
	root: string,
	modules: ReadonlyArray<Module>,
	options: WriteOptions
): Array<string> {
	const stale: Array<string> = [];
	const wanted = new Set(modules.map((m) => m.path));
	const codes =
		options.format === undefined
			? modules.map((m) => m.code)
			: options.format(modules.map((m) => m.code));
	for (const [i, m] of modules.entries()) {
		const path = join(root, m.path);
		const code = codes[i]!;
		const now = existsSync(path) ? readFileSync(path, 'utf8') : null;
		if (now === code) continue;
		stale.push(m.path);
		if (options.check) continue;
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(path, code);
	}
	const owned = options.owned;
	if (owned !== undefined && existsSync(root))
		for (const file of readdirSync(root, {
			recursive: true,
			encoding: 'utf8'
		})) {
			const path = file.split(sep).join('/');
			if (!owned(path) || wanted.has(path)) continue;
			if (statSync(join(root, file)).isDirectory()) continue;
			stale.push(path);
			if (!options.check) rmSync(join(root, file));
		}
	return stale;
}
