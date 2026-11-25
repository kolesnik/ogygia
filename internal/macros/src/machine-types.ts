/**
 * Which `$machine` definition a call site belongs to, read from types: a site does not say
 * (`this.#hole.go('armed')`: `#hole` is a private field typed `Hole`), so the build asks the
 * TypeScript checker, over one Program of the package (compilerkit's `TypedProgram`).
 *
 * - A machine (`Run<S, T>`, `@ogygia/machine`'s run.ts) is resolved by its steps' type `T`, the
 *   very type its definition's `$machine` call returned (`RunDef<S, T, I>`).
 * - A state's value (`StateOf<S>`, `StateIn<S, K>`, a machine's `now`) is resolved by its states'
 *   data `S`; two definitions of the same `S` resolve only when they number their states alike.
 * - A site whose machine the types cannot name (a bare `Run`, a type parameter, two machines
 *   that number a state differently) is refused: the build says where, never guesses.
 *
 * @packageDocumentation
 */
import { TypedProgram, nodeAt, ts } from 'ogygia-internal-compilerkit/checker';

/** A definition as the types read it: its name and its states in order (a state's int is its
 *  index). */
export interface MachineAt {
	readonly name: string;
	readonly names: readonly string[];
}

/** What a site is: a machine's (`run`: a machine itself; `state`: one of its states' values), not
 *  one (`null`), or one the types cannot name (`refused`, why). */
export type SiteAt =
	| { readonly of: 'run' | 'state'; readonly machine: MachineAt }
	| { readonly refused: string }
	| null;

interface Read {
	readonly name: string;
	readonly names: readonly string[];
	readonly s: ts.Type;
	readonly t: ts.Type;
}

/** `@ogygia/machine`'s run.ts or machine.ts, as its source or its built declarations. */
const MACHINE_FILE_RE = /[/\\]machine[/\\](?:src|dist)[/\\](run|machine)\.(?:d\.)?ts$/;
const STATE_ALIASES: ReadonlySet<string> = new Set(['StateOf', 'StateIn']);
/** The types whose `kind` is a state's: a state's value, typed or plain. */
const STATE_TYPES: ReadonlySet<string> = new Set(['StateOf', 'State']);

/** The `$machine` definitions of one package's Program, and what its sites are. */
export class MachineTypes {
	readonly typed: TypedProgram;
	#read: { program: ts.Program; defs: readonly Read[] } | null = null;

	constructor(tsconfig: string) {
		this.typed = new TypedProgram(tsconfig);
	}

	/** Every `$machine` definition of the Program, as the types read them. */
	definitions(program: ts.Program): readonly Read[] {
		if (this.#read?.program === program) return this.#read.defs;
		const checker = program.getTypeChecker();
		const defs: Read[] = [];
		for (const sf of program.getSourceFiles()) {
			if (sf.isDeclarationFile || !sf.text.includes('$machine')) continue;
			const visit = (n: ts.Node): void => {
				if (is_definition(n)) {
					const read = read_definition(checker, n);
					if (read !== null) defs.push(read);
				}
				ts.forEachChild(n, visit);
			};
			visit(sf);
		}
		this.#read = { program, defs };
		return defs;
	}

	/** The definition the `$machine<S>()({ … })` call spanning `start`–`end` of `file` makes, as the
	 *  types read it (null: not one the Program has). */
	definition(file: string, code: string, start: number, end: number): MachineAt | null {
		const at = this.typed.at(file, code);
		if (at === null) return null;
		const node = nodeAt(at.file, start, end);
		if (node === null || !is_definition(node)) return null;
		return read_definition(at.checker, node);
	}

	/** What the member read (`X.kind`) or the call (`X.go(…)`) spanning `start`–`end` of `file`
	 *  is. */
	site(file: string, code: string, start: number, end: number): SiteAt {
		const at = this.typed.at(file, code);
		if (at === null)
			return {
				refused: `${file} is not in ${this.typed.tsconfig}: the build cannot read its types`
			};
		const node = nodeAt(at.file, start, end);
		const access = node !== null && ts.isCallExpression(node) ? node.expression : node;
		if (access === null || !ts.isPropertyAccessExpression(access)) return null;
		const checker = at.checker;
		const symbol = checker.getSymbolAtLocation(access.name);
		const where = declared_in(symbol);
		if (where === null) return null;
		const defs = this.definitions(at.program);
		if (where === 'run') return run_site(checker, defs, access.expression);
		return state_site(checker, defs, access.expression);
	}
}

function is_definition(n: ts.Node): n is ts.CallExpression {
	return (
		ts.isCallExpression(n) &&
		ts.isCallExpression(n.expression) &&
		ts.isIdentifier(n.expression.expression) &&
		n.expression.expression.text === '$machine'
	);
}

function read_definition(checker: ts.TypeChecker, call: ts.CallExpression): Read | null {
	const type = checker.getTypeAtLocation(call);
	const args = type_arguments(checker, type);
	if (args === null || args.length < 2) return null;
	const [s, t] = args as [ts.Type, ts.Type];
	const config = call.arguments[0];
	let name = '';
	if (config !== undefined && ts.isObjectLiteralExpression(config))
		for (const p of config.properties)
			if (
				ts.isPropertyAssignment(p) &&
				ts.isIdentifier(p.name) &&
				p.name.text === 'name' &&
				ts.isStringLiteralLike(p.initializer)
			)
				name = p.initializer.text;
	const names = checker.getPropertiesOfType(t).map((p) => p.name);
	return { name, names, s, t };
}

function type_arguments(checker: ts.TypeChecker, type: ts.Type): readonly ts.Type[] | null {
	if (!(type.flags & ts.TypeFlags.Object)) return null;
	if (!((type as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference)) return null;
	return checker.getTypeArguments(type as ts.TypeReference);
}

/** Where a property is declared: a machine's own (`run`: class `Run`'s, run.ts), a state's (`state`:
 *  the `kind` of `StateOf` or `State`), or neither (a machine with names, `Named` or `machine()`'s
 *  `Machine`, keeps them in every build). */
function declared_in(symbol: ts.Symbol | undefined): 'run' | 'state' | null {
	const decls = symbol?.declarations ?? [];
	let found: 'run' | 'state' | null = null;
	for (const d of decls) {
		const file = MACHINE_FILE_RE.exec(d.getSourceFile().fileName)?.[1];
		if (file === undefined) return null;
		const owner = ts.findAncestor(
			d,
			(a) =>
				ts.isClassDeclaration(a) || ts.isTypeAliasDeclaration(a) || ts.isInterfaceDeclaration(a)
		);
		const name = owner === undefined ? undefined : (owner as ts.NamedDeclaration).name?.getText();
		const of =
			file === 'run' && owner !== undefined && ts.isClassDeclaration(owner) && name === 'Run'
				? 'run'
				: owner !== undefined && ts.isTypeAliasDeclaration(owner) && STATE_TYPES.has(name!)
					? 'state'
					: null;
		if (of === null || (found !== null && found !== of)) return null;
		found = of;
	}
	return found;
}

/** The type arguments of a machine's type, if it is an instance of class `Run` (run.ts). */
function run_arguments(checker: ts.TypeChecker, type: ts.Type): readonly ts.Type[] | null {
	const decl = type.getSymbol()?.declarations?.[0];
	if (decl === undefined || !ts.isClassDeclaration(decl) || decl.name?.text !== 'Run') return null;
	if (MACHINE_FILE_RE.exec(decl.getSourceFile().fileName)?.[1] !== 'run') return null;
	return type_arguments(checker, type);
}

const refused = (why: string): SiteAt => ({ refused: why });

function run_site(checker: ts.TypeChecker, defs: readonly Read[], receiver: ts.Expression): SiteAt {
	const type = checker.getNonNullableType(checker.getTypeAtLocation(receiver));
	const members = type.isUnion() ? type.types : [type];
	let found: MachineAt | null = null;
	for (const member of members) {
		const args = run_arguments(checker, member);
		if (args === null || args.length < 2)
			return refused(
				`its machine is typed ${checker.typeToString(type)}, not a machine of one definition`
			);
		const t = args[1]!;
		const def = defs.find((d) => d.t === t);
		if (def === undefined)
			return refused(
				`its machine (${checker.typeToString(member)}) is not made by a $machine definition the build can see`
			);
		if (found !== null && !same(found.names, def.names))
			return refused(
				`it may be machine ${found.name} or ${def.name}, which number their states differently`
			);
		found ??= { name: def.name, names: def.names };
	}
	return found === null ? null : { of: 'run', machine: found };
}

function state_site(
	checker: ts.TypeChecker,
	defs: readonly Read[],
	receiver: ts.Expression
): SiteAt {
	const inner = skip_outer(receiver);
	// a machine's `now`: its machine says which
	if (ts.isPropertyAccessExpression(inner) && inner.name.text === 'now') {
		const now = declared_in(checker.getSymbolAtLocation(inner.name));
		if (now === 'run') {
			const run = run_site(checker, defs, inner.expression);
			return run !== null && 'machine' in run ? { of: 'state', machine: run.machine } : run;
		}
	}
	// a name: the type it was declared with (a read narrowed by a compare forgets its machine)
	let type = checker.getTypeAtLocation(inner);
	if (ts.isIdentifier(inner)) {
		const symbol = checker.getSymbolAtLocation(inner);
		if (symbol !== undefined) type = checker.getTypeOfSymbol(symbol);
	}
	const s = states_of(checker.getNonNullableType(type));
	if (s === null)
		return refused(
			`its state is typed ${checker.typeToString(type)}: the build reads a machine's state from StateOf<S>, StateIn<S, K> or the machine's now`
		);
	const of = defs.filter((d) => d.s === s);
	if (of.length === 0)
		return refused(`its states (${checker.typeToString(s)}) are no $machine definition's`);
	for (const d of of)
		if (!same(d.names, of[0]!.names))
			return refused(
				`machines ${of[0]!.name} and ${d.name} have these states and number them differently`
			);
	return { of: 'state', machine: { name: of[0]!.name, names: of[0]!.names } };
}

/** `S` of a state's type: `StateOf<S>`, `StateIn<S, K>`, or one of them less `Stale`. */
function states_of(type: ts.Type): ts.Type | null {
	const alias = type.aliasSymbol;
	if (alias !== undefined && STATE_ALIASES.has(alias.name))
		return type.aliasTypeArguments?.[0] ?? null;
	if (alias?.name === 'Exclude' || alias?.name === 'Fresh') {
		const inner = type.aliasTypeArguments?.[0];
		return inner === undefined ? null : states_of(inner);
	}
	if (type.isUnion()) {
		let found: ts.Type | null = null;
		for (const member of type.types) {
			if (member.flags & ts.TypeFlags.UniqueESSymbol) continue;
			const s = states_of(member);
			if (s === null || (found !== null && s !== found)) return null;
			found = s;
		}
		return found;
	}
	return null;
}

function skip_outer(e: ts.Expression): ts.Expression {
	let n = e;
	while (ts.isParenthesizedExpression(n) || ts.isNonNullExpression(n) || ts.isAsExpression(n))
		n = n.expression;
	return n;
}

const same = (a: readonly string[], b: readonly string[]): boolean =>
	a.length === b.length && a.every((x, i) => x === b[i]);
