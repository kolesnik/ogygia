/**
 * Reading the tree: oxc's ESTree nodes, and the questions every macro asks of them (is this a
 * call of `$name`, what member does it read, what type is a declaration annotated with).
 *
 * @packageDocumentation
 */
import { walk } from 'zimmerframe';

/** oxc's ESTree nodes, loosely typed: a pass checks `type` before it reads a field. */
// oxlint-disable-next-line typescript/no-explicit-any -- every pass reads fields of oxc's nodes by name after checking `type`
export type N = any;

/** Whether `node` calls the plain identifier `callee`. */
export function isCall(node: N, callee: string): boolean {
	return (
		node?.type === 'CallExpression' &&
		node.callee.type === 'Identifier' &&
		node.callee.name === callee
	);
}

/** `$ns.name(...)` → `"$ns.name"`; `$name(...)` → `"$name"`; else null. */
export function macroName(node: N): string | null {
	if (node?.type !== 'CallExpression') return null;
	const c = node.callee;
	if (c.type === 'Identifier' && c.name.startsWith('$')) return c.name;
	if (
		c.type === 'MemberExpression' &&
		!c.computed &&
		c.object.type === 'Identifier' &&
		c.object.name.startsWith('$')
	)
		return `${c.object.name}.${c.property.name}`;
	return null;
}

/** The name a static member access reads (`a.b` → `"b"`), or null. */
export function member(node: N): string | null {
	return node?.type === 'MemberExpression' && !node.computed && node.property.type === 'Identifier'
		? node.property.name
		: null;
}

/** A property's or a class member's key, as text. */
export function keyName(p: N): string {
	if (p.key.type === 'Identifier' || p.key.type === 'PrivateIdentifier') return p.key.name;
	return String(p.key.value);
}

/** The type reference a declaration is annotated with: `T`, or `T` in `T | null` / `T | undefined`. */
export function declaredRef(param: N): N {
	let t = param?.typeAnnotation?.typeAnnotation;
	if (t?.type === 'TSUnionType') {
		const kept = t.types.filter(
			(u: N) => u.type !== 'TSNullKeyword' && u.type !== 'TSUndefinedKeyword'
		);
		t = kept.length === 1 ? kept[0] : null;
	}
	return t?.type === 'TSTypeReference' ? t : null;
}

/** The name of the type a declaration is annotated with, or null. */
export function typeName(param: N): string | null {
	const t = declaredRef(param);
	return t === null ? null : refName(t);
}

/** A type reference's name: `Scope`, or `ns.Name` for a qualified one. */
export function refName(ref: N): string | null {
	const n = ref.typeName;
	if (n?.type === 'Identifier') return n.name;
	if (n?.type === 'TSQualifiedName' && n.left.type === 'Identifier')
		return `${n.left.name}.${n.right.name}`;
	return null;
}

/** Statements, counted so the emitter can prove an edit didn't merge or split any (ASI). */
export function countStatements(node: N): number {
	let n = 0;
	walk(node, null, {
		_(child: N, { next }) {
			if (
				typeof child.type === 'string' &&
				/(Statement|Declaration)$/.test(child.type) &&
				child.type !== 'BlockStatement' &&
				!child.type.startsWith('TS')
			)
				n++;
			next();
		}
	});
	return n;
}

/** Whether `node` sits where an expression needs no parentheses around it. */
export function bareSpot(node: N, parent: N): boolean {
	return (
		(parent?.type === 'IfStatement' && parent.test === node) ||
		(parent?.type === 'ConditionalExpression' && parent.test === node) ||
		(parent?.type === 'VariableDeclarator' && parent.init === node) ||
		parent?.type === 'ReturnStatement' ||
		(parent?.type === 'ArrowFunctionExpression' && parent.body === node)
	);
}
