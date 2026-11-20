// ── ogygia/no-macro-in-svelte ─────────────────────────────────────────────
// ogygia's build-time macros ($dev, $await, …, internal/macros/src/names.ts) compile only in plain
// .ts source. In a .svelte file `$dev` reads a store named `dev`, and in a .svelte.ts or .svelte.js
// module Svelte refuses an unknown `$` name: the macro compiler never reads either, so a macro
// there would ship as written. Package source only (an app's own stores keep any name).

import { MACRO_NAMES } from '../../macros/src/names.ts';
import { ALL_SOURCE, type Context, type Node } from './shared.ts';

const SVELTE_RE = /\.svelte(\.[cm]?[jt]s)?$/;
const NAMES: ReadonlySet<string> = new Set(MACRO_NAMES);

export const no_macro_in_svelte = {
	meta: {
		type: 'problem',
		docs: { description: "ogygia's macros are never written in a Svelte file." }
	},
	create(context: Context) {
		const file = (context.filename ?? context.getFilename?.() ?? '').replaceAll('\\', '/');
		if (!ALL_SOURCE.test(file) || !SVELTE_RE.test(file)) return {};
		return {
			Identifier(node: Node) {
				const name = node.name as string;
				if (!NAMES.has(name)) return;
				const parent = node.parent as Node | undefined;
				if (
					(parent?.type === 'MemberExpression' && parent.property === node && !parent.computed) ||
					(parent?.type === 'Property' && parent.key === node && !parent.computed)
				)
					return;
				context.report({
					node,
					message: `${name} is one of ogygia's build-time macros, which compile only in plain .ts source: a Svelte file would ship it as written. Write the plain code here, or move it to a .ts module.`
				});
			}
		};
	}
};
