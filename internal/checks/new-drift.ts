// NO NEW HAND-WRITTEN MACRO WORK. Once a macro does a job (internal/macros), a line a change ADDS that
// does the same job by hand fails here: an `await` of a STALE-capable call outside `$await`, a
// dev-only call behind a hand-written `if (DEV)`. Old lines pass (a sweep converts them); each drift
// is live only once its macro is built (in the compiler's vocabulary), so the table can list the
// drifts of macros still to come.
//
//   node internal/checks/new-drift.ts                 the base as new-comments.ts picks it
//   node internal/checks/new-drift.ts --base <rev>    against that revision
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VOCABULARY } from '../macros/src/compiler.ts';
import { added_lines } from './new-comments.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
/** The files the macros compile: plain TypeScript of core's source (internal/macros never reads a
 *  Svelte file). */
const COMPILED_RE = /^packages\/core\/src\/.*(?<!\.svelte)\.ts$/;

/** A job a macro does, and the hand-written shape of it. */
export interface Drift {
	/** The macro that does it. */
	readonly macro: string;
	/** A line that does it by hand. */
	readonly by_hand: RegExp;
	/** What to write instead. */
	readonly says: string;
}

/** Every drift, by macro. Live only when its macro is built. */
export const DRIFTS: ReadonlyArray<Drift> = [
	{
		macro: '$await',
		by_hand: /\bawait\s+[^;]*?\.(?:task|wait)\(/,
		says: 'an await of a STALE-capable call is written `$await(…)`: the STALE check after it is the build’s'
	},
	{
		macro: '$dev',
		by_hand: /\bif\s*\(\s*import\.meta\.env\??\.DEV\s*\)\s*[a-z_$][\w$]*\(/,
		says: 'a dev-only call is a `$dev` function called plainly: the build puts it behind the dev gate'
	},
	{
		macro: '$rules',
		by_hand: /\bif\s*\(\s*RULES\s*\)\s*[a-z_$][\w$]*\(/,
		says: 'a rules-tier call is a `$rules` function called plainly: the build puts it behind the rules gate'
	}
];

/** One added line that does a macro's job by hand. */
export interface DriftFinding {
	readonly file: string;
	readonly line: number;
	readonly macro: string;
	readonly says: string;
}

/** The added lines (by file, 1-based, with their text) that drift, from the drifts whose macro is in
 *  `built`. */
export function drift_findings(
	added: ReadonlyMap<string, ReadonlyMap<number, string>>,
	built: ReadonlyArray<string>,
	drifts: ReadonlyArray<Drift> = DRIFTS
): DriftFinding[] {
	const live = drifts.filter((d) => built.includes(d.macro));
	const found: DriftFinding[] = [];
	for (const [file, lines] of added) {
		if (!COMPILED_RE.test(file)) continue;
		for (const [line, text] of lines)
			for (const d of live)
				if (d.by_hand.test(text)) found.push({ file, line, macro: d.macro, says: d.says });
	}
	return found.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

/** Each added line of the change against `base`, with its text. */
export function added_text(root: string, base: string): Map<string, Map<number, string>> {
	const out = new Map<string, Map<number, string>>();
	for (const [file, lines] of added_lines(root, base)) {
		const text = readFileSync(path.join(root, file), 'utf8').split('\n');
		out.set(file, new Map([...lines].map((n) => [n, text[n - 1] ?? ''])));
	}
	return out;
}

function default_base(root: string): string {
	const git = (args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
	if (process.env.NEW_DRIFT_BASE) return process.env.NEW_DRIFT_BASE;
	if (git(['rev-list', '--parents', '-n1', 'HEAD']).split(' ').length > 2) return 'HEAD^1';
	return git(['merge-base', 'origin/main', 'HEAD']);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const at = process.argv.indexOf('--base');
	const base = at === -1 ? default_base(ROOT) : process.argv[at + 1];
	const found = drift_findings(added_text(ROOT, base), VOCABULARY);
	for (const f of found) console.error(`${f.file}:${f.line}: ${f.says} (${f.macro})`);
	if (found.length > 0) {
		console.error(
			`\n${found.length} added line(s) do a macro's job by hand (internal/checks/new-drift.ts)`
		);
		process.exit(1);
	}
	console.log(`no added line does a built macro's job by hand, against ${base}`);
}
