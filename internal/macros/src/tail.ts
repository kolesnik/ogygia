/**
 * Where an `$await` needs no STALE check: one the build writes there would give up by returning
 * nothing, which is what ending does. The `$await` pass writes none there, and the failure ledger
 * (internal/sim failures.ts) counts no site there: one rule, read by both.
 *
 * @packageDocumentation
 */

/** A syntax node of either parser (ESTree shapes). */
type Node = { readonly type: string; readonly [key: string]: unknown };

const FUNCTION_RE = /^(?:Arrow)?Function(?:Expression|Declaration)$/;

/** Whether `statement` (its ancestors `path`, the statement last) is the last statement of its
 *  function's own body. */
export function ends_its_function(statement: Node, path: ReadonlyArray<Node>): boolean {
	const block = path.at(-2);
	const fn = path.at(-3);
	return (
		block?.type === 'BlockStatement' &&
		(block.body as ReadonlyArray<Node>).at(-1) === statement &&
		fn !== undefined &&
		FUNCTION_RE.test(fn.type) &&
		fn.body === block
	);
}
