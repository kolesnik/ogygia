/**
 * A `<` in a markdown text node is text: CommonMark reads `if it is < 512KB`, `I <3 it` and an
 * unclosed `a <b and c` as characters, and the markdown parser keeps them in text nodes (a real tag
 * is a raw node). mdsvex writes text nodes as they are, so Svelte would read each `<` as the start
 * of a tag and fail the build. This writes each one as `&lt;`, outside `{…}`: an expression in
 * prose is Svelte's, and its `<` is JavaScript.
 */
type HastNode = { type?: string; value?: string; children?: HastNode[] };

/** `value` with every `<` outside braces written as `&lt;`. */
export function escape_text_lt(value: string): string {
	if (!value.includes('<')) return value;
	let out = '';
	let depth = 0;
	for (const ch of value) {
		if (ch === '{') depth++;
		else if (ch === '}' && depth > 0) depth--;
		out += ch === '<' && depth === 0 ? '&lt;' : ch;
	}
	return out;
}

/** The rehype plugin. */
export function rehypeTextLt() {
	const walk = (node: HastNode): void => {
		if (node.type === 'text' && typeof node.value === 'string')
			node.value = escape_text_lt(node.value);
		if (Array.isArray(node.children)) for (const c of node.children) walk(c);
	};
	return (tree: HastNode): void => walk(tree);
}
