// ── ogygia/downloads-heard ────────────────────────────────────────────────

import type { Context, Node } from './shared.ts';

/** A test file: a package's or an app's `test/` tree. */
const TEST_FILE = /(^|\/)test\//;
/** The timeline's own methods: reads of it, and the calls that change what it holds. */
const TIMELINE_CALLS: ReadonlySet<string> = new Set([
	'getEntriesByType',
	'getEntriesByName',
	'clearResourceTimings',
	'setResourceTimingBufferSize'
]);
const MESSAGE_DOWNLOADS_HEARD =
	"A page's resource timeline keeps 250 entries and drops each one after, and a dev run's frame fills it with its source modules: read from it, a download is missed (a wait times out) and a check that a file was never asked passes without looking. Read downloads from a Downloads (@ogygia/tooling/vitest/downloads), which hears every one; start a test with the timeline full with timeline_full().";

/** The name of `performance.<name>(…)`'s method when `node` is such a call, else null. */
function timeline_call(node: Node): string | null {
	const callee = node.callee as Node;
	if (callee.type !== 'MemberExpression') return null;
	const object = callee.object as Node;
	if (object.type !== 'Identifier' || (object as { name?: string }).name !== 'performance')
		return null;
	const name = (callee.property as { name?: string }).name;
	return name !== undefined && TIMELINE_CALLS.has(name) ? name : null;
}

/** `getEntriesByType` reads the timeline only for resources: `'navigation'` and the rest hold one
 *  entry or are not capped. */
function reads_resources(node: Node, name: string): boolean {
	if (name !== 'getEntriesByType') return true;
	const kind = (node.arguments as Node[])[0];
	return !(kind?.type === 'Literal' && (kind as { value?: unknown }).value !== 'resource');
}

export const downloads_heard = {
	meta: {
		type: 'problem',
		docs: {
			description:
				"Tests read downloads from an observer, never the page's capped resource timeline."
		}
	},
	create(context: Context) {
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		if (!TEST_FILE.test(file)) return {};
		return {
			CallExpression(node: Node) {
				const name = timeline_call(node);
				if (name !== null && reads_resources(node, name))
					context.report({ node, message: MESSAGE_DOWNLOADS_HEARD });
			}
		};
	}
};
