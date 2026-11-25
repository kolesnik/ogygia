/**
 * Gates: the conditions code runs behind, as output writes them, so the builds a gate is false in
 * fold it and drop whatever only it reaches. A compiler names its gates (`dev`, and any other tier
 * its project has, such as a rules tier that survives in some production builds) and puts calls
 * behind one with `gated`.
 *
 * A gate's condition belongs to one file's output: it may import what it reads
 * (`importedGate`), hoist it as a constant (`hoistedGate`), or be an expression written in place
 * (`expressionGate`). Each file imports or hoists it once.
 *
 * @packageDocumentation
 */
import type { N } from './ast.ts';
import type { Emitter } from './emitter.ts';

/** A named condition code runs behind. */
export interface Gate {
	/** The name a compiler picks it by (`dev`, `rules`). */
	readonly name: string;
	/** The condition in `emitter`'s file: an expression that binds tighter than `&&` and `?:`. */
	check(emitter: Emitter): string;
}

/** The development check every app bundler folds (`process.env.NODE_ENV` set to `'production'`). */
export const DEV_CHECK = "process.env.NODE_ENV !== 'production'";

/** The default `dev` gate: `DEV_CHECK`, written in place. */
export const NODE_ENV_DEV: Gate = expressionGate('dev', DEV_CHECK);

/** A gate written in place as `expression` (which binds tighter than `&&` and `?:`). */
export function expressionGate(name: string, expression: string): Gate {
	return { name, check: () => expression };
}

/** A gate that reads the named export `exported` of `spec` (`DEV` from `esm-env`), imported once
 *  per file. */
export function importedGate(name: string, spec: string, exported: string): Gate {
	return { name, check: (emitter) => emitter.imported(spec, exported) };
}

const WHITESPACE_RE = /\s+/g;
const same_code = (a: string, b: string): boolean =>
	a.replace(WHITESPACE_RE, '') === b.replace(WHITESPACE_RE, '');

/** A gate hoisted once per file as `const <local> = <expression>;` (a file that declares that
 *  constant itself, at its top and of the same expression, keeps its own), under `local` or, when the file
 *  binds it, `local_1`…. */
export function hoistedGate(name: string, local: string, expression: string): Gate {
	const declared = new WeakMap<Emitter, string>();
	return {
		name,
		check(emitter) {
			const known = declared.get(emitter);
			if (known !== undefined) return known;
			const own = new RegExp(`^const ${local}\\s*=([^;]*);`, 'm').exec(emitter.s.original);
			if (own !== null && same_code(own[1]!, expression)) {
				declared.set(emitter, local);
				return local;
			}
			const fresh = emitter.fresh(local);
			emitter.hoisted.push(`const ${fresh} = ${expression};`);
			declared.set(emitter, fresh);
			return fresh;
		}
	};
}

/** Puts `node` (a call that is a statement) behind `gate`: `check && node`. */
export function gated(emitter: Emitter, node: N, gate: Gate): void {
	emitter.s.appendLeft(node.start, `${gate.check(emitter)} && `);
}
