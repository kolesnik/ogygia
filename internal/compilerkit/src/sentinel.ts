/**
 * A sentinel checked after every await. Some waits settle with a sentinel instead of a value (a
 * task whose owner closed settles `STALE`): the code after the await must check it at once and
 * give up. This writes the check, and finds the awaits that skip it.
 *
 * @packageDocumentation
 */
import { walk } from 'zimmerframe';
import type { N } from './ast.ts';

/** The sentinel, and how the code gives up when a wait settles with it. */
export interface Sentinel {
	/** The sentinel's expression in the output (`$.STALE`). */
	readonly sentinel: string;
	/** What the function returns when it gives up (empty: a bare `return`). */
	readonly giveUp: string;
}

/** The check after a wait bound to `binding`: `if (binding === sentinel) return giveUp`. */
export function giveUpIf(binding: string, s: Sentinel): string {
	return `if (${binding} === ${s.sentinel}) return${s.giveUp === '' ? '' : ` ${s.giveUp}`}`;
}

/** The check of a wait nobody binds: `if ((await <task>) === sentinel) return giveUp`, split
 *  around the task's text so a template can keep the task's own node. */
export function giveUpAround(s: Sentinel): readonly [head: string, tail: string] {
	return ['if ((await ', `) === ${s.sentinel}) return${s.giveUp === '' ? '' : ` ${s.giveUp}`}`];
}

/** Every `await` in `program` of something that may settle with the sentinel (`mayBe`). */
export function rawAwaits(program: N, mayBe: (awaited: N) => boolean): Array<N> {
	const out: Array<N> = [];
	walk(program, null, {
		AwaitExpression(node: N, { next }) {
			if (mayBe(node.argument)) out.push(node);
			next();
		}
	});
	return out;
}
