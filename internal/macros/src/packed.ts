/**
 * What a published package must not carry from ogygia's macros: a macro left in its JavaScript (a
 * build that skipped the compiler), a macro named in its declarations (it exists only at build
 * time), and a dependency on the macro packages (no compiler ships).
 *
 * @packageDocumentation
 */
import { parseSync, publishedTypes, vocabulary } from 'ogygia-internal-compilerkit';
import { VOCABULARY } from './compiler.ts';

/** The macro packages: build tools only, never a published package's dependency. */
export const MACRO_PACKAGES: ReadonlyArray<string> = [
	'ogygia-internal-compilerkit',
	'ogygia-internal-macros'
];

/** A packed file: its path in the package, and its text. */
export interface PackedFile {
	readonly path: string;
	readonly text: string;
}

/** The dependency lists a published manifest declares. */
export interface PackedManifest {
	readonly dependencies?: Readonly<Record<string, string>>;
	readonly peerDependencies?: Readonly<Record<string, string>>;
	readonly optionalDependencies?: Readonly<Record<string, string>>;
}

const DTS_RE = /\.d\.[cm]?ts$/;
const JS_RE = /\.[cm]?js$/;

/** Every problem, each naming its file (and line, in a declaration). Empty when the package is
 *  clean. `names` is the macro vocabulary (default: every macro's). */
export function packed_problems(
	files: ReadonlyArray<PackedFile>,
	manifest: PackedManifest,
	names: ReadonlyArray<string> = VOCABULARY
): Array<string> {
	const problems: Array<string> = [];
	for (const field of ['dependencies', 'peerDependencies', 'optionalDependencies'] as const)
		for (const dep of Object.keys(manifest[field] ?? {}))
			if (MACRO_PACKAGES.includes(dep))
				problems.push(`package.json: ${field} names ${dep}, a build tool: no compiler ships.`);
	if (names.length === 0) return problems;
	const words = vocabulary(names);
	for (const file of files) {
		if (DTS_RE.test(file.path)) {
			problems.push(
				...publishedTypes(file.path, file.text, { macros: names, shortened: () => false })
			);
			continue;
		}
		if (!JS_RE.test(file.path) || !words.mayUse(file.text)) continue;
		const parsed = parseSync(file.path, file.text, { lang: 'js', sourceType: 'module' });
		if (parsed.errors.length !== 0) {
			problems.push(`${file.path}: does not parse: ${parsed.errors[0]!.message}`);
			continue;
		}
		for (const name of words.usedIn(parsed.program))
			problems.push(`${file.path}: ${name} is a macro, left uncompiled.`);
	}
	return problems;
}
