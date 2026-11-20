/**
 * Where an import specifier of a source file points, the way the compilers follow imports across
 * files: a relative path (`./list.ts`), or a subpath alias of the file's own package (`#runtime/
 * scope.ts`, from its `package.json` `imports`). Anything else (a package) is not followed.
 *
 * @packageDocumentation
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const packages = new Map<
	string,
	readonly [root: string, imports: Readonly<Record<string, string>>] | null
>();

function packageOf(
	dir: string
): readonly [root: string, imports: Readonly<Record<string, string>>] | null {
	const known = packages.get(dir);
	if (known !== undefined) return known;
	const file = join(dir, 'package.json');
	let found: readonly [string, Readonly<Record<string, string>>] | null;
	if (existsSync(file)) {
		const imports = (
			JSON.parse(readFileSync(file, 'utf8')) as {
				imports?: Record<string, string>;
			}
		).imports;
		found = imports === undefined ? null : [dir, imports];
	} else found = dirname(dir) === dir ? null : packageOf(dirname(dir));
	packages.set(dir, found);
	return found;
}

/** The file `spec`, imported from the file `from`, names; null for a package it does not follow. */
export function resolveSpecifier(from: string, spec: string): string | null {
	if (spec.startsWith('.')) return resolve(dirname(from), spec);
	if (!spec.startsWith('#')) return null;
	const pkg = packageOf(dirname(from));
	if (pkg === null) return null;
	const [root, imports] = pkg;
	for (const [key, target] of Object.entries(imports)) {
		if (key === spec) return resolve(root, target);
		const star = key.indexOf('*');
		if (
			star !== -1 &&
			spec.length >= key.length - 1 &&
			spec.startsWith(key.slice(0, star)) &&
			spec.endsWith(key.slice(star + 1))
		)
			return resolve(
				root,
				target.replace('*', spec.slice(star, spec.length - (key.length - star - 1)))
			);
	}
	return null;
}
