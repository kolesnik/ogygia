/**
 * The final step, build output only: members a codebase marks as internal by their name (by
 * default, a name ending in `$`: `element.numbers$`) become short names. The source and every
 * committed generated module keep their readable names; only what lands in a build's output is
 * shortened. One table for the whole build, from every name in its sources, so every chunk
 * agrees.
 *
 * @packageDocumentation
 */
import MagicString from 'magic-string';
import { parseSync } from 'oxc-parser';
import { walk } from 'zimmerframe';
import type { N } from './ast.ts';

/** Which member names are shortened. */
export type Shortened = (name: string) => boolean;

/** The default: a lower-case name ending in `$` (`$name` is a macro, `name$` a member the build
 *  shortens, `$5` what it becomes). */
export const endsInDollar: Shortened = (name) => /^[a-z][A-Za-z0-9]*\$$/.test(name);

const order = (name: string): string => `${name.slice(0, -1)}_`;

function keyOf(node: N): N {
	switch (node.type) {
		case 'MemberExpression':
			return !node.computed && node.property.type === 'Identifier' ? node.property : null;
		case 'Property':
		case 'PropertyDefinition':
		case 'MethodDefinition':
		case 'TSPropertySignature':
			return !node.computed && node.key.type === 'Identifier' ? node.key : null;
		default:
			return null;
	}
}

type Key = {
	readonly name: string;
	readonly start: number;
	readonly end: number;
	readonly shorthand: boolean;
};

function keys(file: string, code: string, shortened: Shortened): Array<Key> {
	const { program } = parseSync(file, code, {
		lang: 'ts',
		sourceType: 'module'
	});
	const out: Array<Key> = [];
	walk(program as N, null, {
		_(node: N, { next }) {
			const key = keyOf(node);
			if (key !== null && shortened(key.name))
				out.push({
					name: key.name,
					start: key.start,
					end: key.end,
					shorthand: node.type === 'Property' && node.shorthand === true
				});
			next();
		}
	});
	return out;
}

/** The table: each name to shorten to `$0`, `$1`, ... `$$`, `$00`, ... The most used names get the shortest
 *  (ties by name, its marker read as `_`, so a build is the same each time and a name keeps the
 *  place it had before the marker was `$`). */
export function shortNames(
	sources: ReadonlyArray<{ readonly file: string; readonly code: string }>,
	shortened: Shortened = endsInDollar
): ReadonlyMap<string, string> {
	const uses = new Map<string, number>();
	for (const { file, code } of sources)
		for (const key of keys(file, code, shortened))
			uses.set(key.name, (uses.get(key.name) ?? 0) + 1);
	const table = new Map<string, string>();
	[...uses.keys()]
		.sort((a, b) => uses.get(b)! - uses.get(a)! || (order(a) < order(b) ? -1 : 1))
		.forEach((name, i) => table.set(name, `$${shortName(i)}`));
	return table;
}

/** Where a source the build does not shorten names a member the table shortens: a read or a
 *  write that misses the shortened field at run time. Each as `file:line name`. */
export function crossings(
	table: ReadonlyMap<string, string>,
	sources: ReadonlyArray<{ readonly file: string; readonly code: string }>
): Array<string> {
	const out: Array<string> = [];
	for (const { file, code } of sources)
		for (const key of keys(file, code, (name) => table.has(name)))
			out.push(`${file}:${code.slice(0, key.start).split('\n').length} ${key.name}`);
	return out;
}

const DIGITS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ_$';

function shortName(i: number): string {
	let out = '';
	for (let n = i; n >= 0; n = Math.floor(n / 64) - 1) out = DIGITS[n % 64]! + out;
	return out;
}

/** `code` with every member in `table` renamed; a shortened name not in it is an error. */
export function shorten(
	file: string,
	code: string,
	table: ReadonlyMap<string, string>,
	shortened: Shortened = endsInDollar
): string {
	const out = new MagicString(code);
	for (const key of keys(file, code, shortened)) {
		const to = table.get(key.name);
		if (to === undefined)
			throw new Error(`shorten: \`${key.name}\` in ${file} is not in the build's table.`);
		out.overwrite(key.start, key.end, key.shorthand ? `${to}: ${key.name}` : to);
	}
	return out.toString();
}
