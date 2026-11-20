/**
 * Marks at the definition: a function is marked once, where it is defined
 * (`const name = $mark(function name(…) { … })`), and every caller says nothing. A mark may name
 * an exception from a closed list (`$mark.allow('<name>', function name(…) { … })`): the list is
 * a table of names and reasons, so a new exception is a reviewed change to it. A function marked
 * as only ever called (a check that runs in development only, say) is refused anywhere it is
 * handed on as a value or its result is read.
 *
 * @packageDocumentation
 */
import { walk } from 'zimmerframe';
import { macroName, type N } from './ast.ts';

/** Each mark's name (`$hot`, `$hot.allow`) → the place of the function among its arguments. */
export type Marks = Readonly<Record<string, number>>;

/** A marked initializer: the mark, its call, and the argument at the function's place (any node,
 *  or undefined when the call has none there). */
export interface Mark {
	readonly mark: string;
	readonly call: N;
	readonly fn: N;
}

/** A declaration `const name = mark(function name(…) { … })`, and how well it keeps that shape. */
export interface MarkedDefinition extends Mark {
	readonly declarator: N;
	/** At a module's top (a statement of the program, or of its `export`). */
	readonly top: boolean;
	/** A `const` at a module's top whose function is a function expression of the same name. */
	readonly named: boolean;
	/** Nothing follows the function among the mark's arguments. */
	readonly alone: boolean;
}

/** The mark an initializer carries, or null when it is no call of one of `marks`. */
export function markOf(init: N, marks: Marks): Mark | null {
	const mark = macroName(init);
	if (mark === null || !Object.hasOwn(marks, mark)) return null;
	return { mark, call: init, fn: init.arguments[marks[mark]!] };
}

/**
 * A declaration of one name whose initializer carries one of `marks`, with what its shape keeps
 * (`parent` is the statement's parent), or null when `node` is no such declaration.
 */
export function markedDefinition(node: N, parent: N, marks: Marks): MarkedDefinition | null {
	if (node?.type !== 'VariableDeclaration' || node.declarations.length !== 1) return null;
	const declarator = node.declarations[0];
	const found = markOf(declarator.init, marks);
	if (found === null) return null;
	const top = parent?.type === 'Program' || parent?.type === 'ExportNamedDeclaration';
	const { fn } = found;
	return {
		...found,
		declarator,
		top,
		named:
			top &&
			node.kind === 'const' &&
			declarator.id.type === 'Identifier' &&
			fn?.type === 'FunctionExpression' &&
			fn.id?.name === declarator.id.name,
		alone: found.call.arguments.length === marks[found.mark]! + 1
	};
}

/** The name a mark gives from a closed list (`table`'s keys): a string literal naming one, else
 *  null. */
export function namedIn<T extends object>(node: N, table: T): keyof T | null {
	return node?.type === 'Literal' && Object.hasOwn(table, String(node.value))
		? (String(node.value) as keyof T)
		: null;
}

/** How a name that may only be called was used otherwise: handed on as a value, or called where
 *  its result is read. */
export interface Misuse {
	readonly node: N;
	readonly name: string;
	readonly how: 'value' | 'expression';
}

/**
 * The first place in `program` a name of `names` is used but as a call that is a statement (or
 * where it is declared, imported, exported, or a key or member of that name). `node` is the name
 * when it is a value, the call when its result is read.
 */
export function firstMisuse(program: N, names: ReadonlySet<string>): Misuse | null {
	const found: Array<Misuse> = [];
	walk(program, null, {
		_(n: N, { path, next }) {
			if (found.length !== 0) return;
			if (n.type === 'Identifier' && names.has(n.name)) {
				const up = path.at(-1);
				const called = up?.type === 'CallExpression' && up.callee === n;
				const declared = up?.type === 'VariableDeclarator' && up.id === n;
				const named =
					up?.type === 'FunctionExpression' ||
					up?.type === 'ImportSpecifier' ||
					up?.type === 'ExportSpecifier' ||
					(up?.type === 'MemberExpression' && up.property === n) ||
					(up?.type === 'Property' && up.key === n && !up.shorthand);
				const value = !called && !declared && !named;
				const expression = called && path.at(-2)?.type !== 'ExpressionStatement';
				let how: 'value' | 'expression' | null = null;
				if (value) how = 'value';
				else if (expression) how = 'expression';
				if (how !== null) {
					found.push({ node: how === 'value' ? n : up, name: n.name, how });
					return;
				}
			}
			next();
		}
	});
	return found[0] ?? null;
}
