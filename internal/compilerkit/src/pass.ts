/**
 * Passes: one family of macros each, over one walk of the file. At every node the walk asks each
 * pass in order, by the kind of node (a call, a member read, a type reference, a statement); the
 * first that handles it owns it (and walks into it, if it needs to). `S` is what the walk carries
 * down: a scope, or anything a compiler tracks per node.
 *
 * @packageDocumentation
 */
import { walk } from 'zimmerframe';
import type { N } from './ast.ts';

/** What a pass sees at a node of the rewrite walk. */
export interface Visit<S = unknown> {
	scope: S;
	parent: N;
	path: ReadonlyArray<N>;
	next(): void;
}

/** One family of macros. Each hook returns true when it handled the node (and descended, if needed). */
export interface Pass<S = unknown> {
	call?(node: N, v: Visit<S>): boolean;
	member?(node: N, v: Visit<S>): boolean;
	typeRef?(node: N, v: Visit<S>): boolean;
	statement?(node: N, v: Visit<S>): boolean;
	/** Before the walk: a whole-file scan. */
	prepare?(): void;
	/** After the walk: a last whole-file check. */
	done?(): void;
}

/** The hook a node asks the passes for, or null: the walk only goes on. */
export function hookOf(node: N): 'call' | 'member' | 'typeRef' | 'statement' | null {
	switch (node.type) {
		case 'CallExpression':
			return 'call';
		case 'MemberExpression':
			return 'member';
		case 'TSTypeReference':
			return 'typeRef';
		default:
			return /(Statement|Declaration)$/.test(node.type) ? 'statement' : null;
	}
}

/**
 * Walks `node` through `passes`: at each node, `scopeAt` gives what the walk carries there, and
 * the first pass whose hook handles the node owns it.
 */
export function walkPasses<S>(
	node: N,
	state: S,
	passes: ReadonlyArray<Pass<S>>,
	scopeAt: (node: N, state: S) => S
): void {
	walk(node, state as Record<string, unknown> | null, {
		_(n: N, c: { state: unknown; path: Array<N>; next: (s?: never) => void }) {
			const scope = scopeAt(n, c.state as S);
			const v: Visit<S> = {
				scope,
				parent: c.path.at(-1),
				path: c.path,
				next: () => c.next(scope as never)
			};
			const hook = hookOf(n);
			if (hook !== null) for (const p of passes) if (p[hook]?.(n, v) === true) return;
			c.next(scope as never);
		}
	});
}
