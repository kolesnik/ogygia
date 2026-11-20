/**
 * Build-time evaluation: closed code run while the build runs, its result shipped as data. The
 * code may read only pure globals (`Math`, `Object`, ...) and the values it is handed by name; any
 * other free name is unknown at build time. The result must be data (finite numbers, strings,
 * booleans, null, arrays and plain objects of them): it is written into the output as a literal.
 * Code may also read a module's top-level constants, and those of the modules it imports
 * (relative), each itself known at build.
 *
 * @packageDocumentation
 */
import { transformSync } from 'esbuild';
import { parseSync } from './oxc.ts';
import { analyze } from 'periscopic';
import type { N } from './ast.ts';
import { markOf, type Marks } from './marks.ts';
import { relativeImports, type Import } from './modules.ts';

/** The globals build-time code may read: pure, and the same at build and at run time. */
export const PURE_GLOBALS: ReadonlySet<string> = new Set([
	'Math',
	'Number',
	'String',
	'Array',
	'Object',
	'JSON',
	'Infinity',
	'NaN',
	'undefined'
]);

/** Build-time code read a name the build does not know. */
export class UnknownAtBuild extends Error {
	readonly unknown: string;
	constructor(name: string) {
		super(`reads "${name}", which isn't known at build time.`);
		this.unknown = name;
	}
}

/** The free names of an expression (TypeScript), other than the pure globals, sorted. */
export function freeNames(source: string): Array<string> {
	const js = transformSync(`(${source})`, { loader: 'ts' }).code;
	const { globals } = analyze(parseSync('value.js', js).program as N);
	return [...globals.keys()].filter((name) => !PURE_GLOBALS.has(name)).sort();
}

/**
 * Runs an expression (TypeScript) at build time with `bindings` in scope. A free name that is
 * neither a pure global nor bound is an error naming it.
 */
export function evaluate(
	source: string,
	bindings: Readonly<Record<string, unknown>> = {}
): unknown {
	const js = transformSync(`(${source})`, { loader: 'ts' }).code;
	const { globals } = analyze(parseSync('value.js', js).program as N);
	for (const name of globals.keys())
		if (!PURE_GLOBALS.has(name) && !(name in bindings)) throw new UnknownAtBuild(name);
	const names = Object.keys(bindings);
	// oxlint-disable-next-line no-new-func, typescript/no-implied-eval -- build-time evaluation of closed, checked code is the purpose
	return new Function(...names, `return ${js}`)(...names.map((n) => bindings[n]));
}

/** Whether a value is data: finite numbers, strings, booleans, null, and arrays and plain
 *  objects of them. */
export function isData(value: unknown): boolean {
	if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
	if (typeof value === 'number') return Number.isFinite(value);
	if (Array.isArray(value)) return value.every(isData);
	if (typeof value !== 'object') return false;
	const proto = Object.getPrototypeOf(value);
	return (
		(proto === Object.prototype || proto === null) && Object.values(value as object).every(isData)
	);
}

/** A data value as a literal the output holds, or null when it is not data. */
export function dataLiteral(value: unknown): string | null {
	return isData(value) ? JSON.stringify(value) : null;
}

/** A name build-time code reads that is no constant known at build: not a top-level const here
 *  or in a module this one imports, or one whose value reads itself (`cycle`). */
export class NotConstant extends Error {
	readonly unknown: string;
	readonly cycle: boolean;
	constructor(name: string, cycle: boolean) {
		super(
			cycle
				? `"${name}" reads itself.`
				: `"${name}" is not a constant known at build (a top-level const, here or in a file this one imports).`
		);
		this.unknown = name;
		this.cycle = cycle;
	}
}

/** A module's constants, as build-time code reads them: each top-level const's initializer
 *  source, and the values it imports from relative modules. */
export interface Constants {
	readonly file: string;
	readonly consts: ReadonlyMap<string, string>;
	readonly imports: ReadonlyMap<string, Import>;
}

const unwrapped = (init: N): N =>
	init?.type === 'TSAsExpression' || init?.type === 'TSSatisfiesExpression'
		? unwrapped(init.expression)
		: init;

/**
 * The constants of the module at `file` (its text `code`). A const whose initializer carries one
 * of `marks` (a function run at build, say) is that argument, in parentheses.
 */
export function constantsOf(file: string, code: string, marks: Marks = {}): Constants {
	const { program } = parseSync(file, code, {
		lang: 'ts',
		sourceType: 'module'
	});
	const consts = new Map<string, string>();
	for (const node of program.body as Array<N>) {
		const d = node.type === 'ExportNamedDeclaration' ? node.declaration : node;
		if (d?.type !== 'VariableDeclaration' || d.kind !== 'const') continue;
		for (const v of d.declarations)
			if (v.id.type === 'Identifier' && v.init) {
				const init = unwrapped(v.init);
				const marked = markOf(init, marks);
				consts.set(
					v.id.name,
					marked === null
						? code.slice(init.start, init.end)
						: `(${code.slice(marked.fn.start, marked.fn.end)})`
				);
			}
	}
	return {
		file,
		consts,
		imports: relativeImports(file, program, { values: true })
	};
}

/**
 * Runs an expression (TypeScript) at build time in `module`: each free name that is no pure
 * global is a constant of the module or one it imports (`load` reads another module), run first.
 * Any other free name is a `NotConstant`.
 */
export function evaluateIn(
	module: Constants,
	source: string,
	load: (file: string) => Constants
): unknown {
	return runIn(module, source, load, new Set());
}

function runIn(
	module: Constants,
	source: string,
	load: (file: string) => Constants,
	seen: ReadonlySet<string>
): unknown {
	const bindings: Record<string, unknown> = {};
	for (const name of freeNames(source))
		bindings[name] = constantIn(module, name, load, new Set(seen));
	return evaluate(source, bindings);
}

function constantIn(
	module: Constants,
	name: string,
	load: (file: string) => Constants,
	seen: Set<string>
): unknown {
	const key = `${module.file}#${name}`;
	if (seen.has(key)) throw new NotConstant(name, true);
	seen.add(key);
	const text = module.consts.get(name);
	if (text !== undefined) return runIn(module, text, load, seen);
	const imported = module.imports.get(name);
	if (imported !== undefined) return constantIn(load(imported.from), imported.name, load, seen);
	throw new NotConstant(name, false);
}
