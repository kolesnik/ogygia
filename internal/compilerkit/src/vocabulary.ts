/**
 * A vocabulary: the global names a compiler's macros own. The compiler reads only these; every
 * other `$` name passes through untouched. A cheap text test says when a file surely uses none,
 * and the tree says which it really uses (a comment or a string names none).
 *
 * @packageDocumentation
 */
import { walk } from 'zimmerframe';
import type { N } from './ast.ts';

/** The global names a compiler's macros own. */
export interface Vocabulary {
	readonly names: ReadonlyArray<string>;
	/** False when `code` surely uses none of them: the file need not be parsed. */
	mayUse(code: string): boolean;
	/** The names `program` uses as values or types (not as a member or a key). */
	usedIn(program: N): Set<string>;
}

/**
 * The vocabulary `names`. A name in `reserved` (another tool's own, such as a framework's) is
 * refused, with `why` in the error.
 */
export function vocabulary(
	names: ReadonlyArray<string>,
	reserved: ReadonlyArray<string> = [],
	why = 'reserved'
): Vocabulary {
	refuseReserved(names, reserved, why);
	const marker = new RegExp(`\\$(?:${names.map((n) => n.replace(/^\$/, '')).join('|')})\\b`);
	return {
		names,
		mayUse: (code) => marker.test(code),
		usedIn(program) {
			const used = new Set<string>();
			walk(program, null, {
				Identifier(node: N, { path, next }) {
					next();
					if (!names.includes(node.name)) return;
					const parent = path.at(-1);
					if (
						(parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) ||
						(parent?.type === 'Property' && parent.key === node && !parent.computed)
					)
						return;
					used.add(node.name);
				}
			});
			return used;
		}
	};
}

/** Refuses a vocabulary that takes a reserved name: `<names>: <why>, so never a macro name.` */
export function refuseReserved(
	names: ReadonlyArray<string>,
	reserved: ReadonlyArray<string>,
	why: string
): void {
	const taken = names.filter((n) => reserved.includes(n));
	if (taken.length !== 0) throw new Error(`${taken.join(', ')}: ${why}, so never a macro name.`);
}
