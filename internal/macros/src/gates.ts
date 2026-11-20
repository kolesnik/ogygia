/**
 * ogygia's gates: the conditions its macros put code behind, as core's own hand-written code reads
 * them today.
 *
 * - `dev`: development only (`import.meta.env.DEV`). Every production build folds it, rules builds
 *   too.
 * - `rules`: development, and production builds made with `OGYGIA_RULES=1` (the e2e suites' and
 *   the simulator's), where `__OGYGIA_RULES__` is defined true. Any other build folds it.
 *
 * @packageDocumentation
 */
import { expressionGate, hoistedGate, type Gate } from 'ogygia-internal-compilerkit';

/** Development only: `import.meta.env.DEV`, as core's hand-written checks read it, written in
 *  place (esm-env's `DEV` reaches a bundle through two re-exports, and rolldown kept the code
 *  behind it: +126 B brotli on the boot). */
export const DEV: Gate = expressionGate('dev', 'import.meta.env.DEV');

/** The rules tier: development, or a build with `OGYGIA_RULES=1`; one constant per file. */
export const RULES: Gate = hoistedGate(
	'rules',
	'RULES',
	"import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false)"
);

/** Every gate a macro may name, by name. */
export const GATES: ReadonlyMap<string, Gate> = new Map([
	[DEV.name, DEV],
	[RULES.name, RULES]
]);
