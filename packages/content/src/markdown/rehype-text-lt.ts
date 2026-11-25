/**
 * A `<` in a markdown text node that cannot start a tag is text: CommonMark reads
 * `if it is < 512KB` and `I <3 it` as characters, and the markdown parser keeps them in text nodes
 * (a real tag is a raw node). mdsvex writes text nodes as they are, so Svelte would read each `<`
 * as the start of a tag and fail the build. This writes each such `<` as `&lt;`. A `<` before a
 * letter, `/`, `!` or `?` can start a tag (an inline component whose attributes are not valid HTML
 * stays in a text node too), so it is left for Svelte, and so is everything up to that tag's `>`
 * outside `{…}`. A `<` inside a `{…}` expression is JavaScript.
 */
type HastNode = { type?: string; value?: string; children?: HastNode[] };

const TAG_START = /[A-Za-z/!?]/;
const TAG_NAME_START = /[A-Za-z/]/;

/** `value` with every `<` that cannot start a tag, outside tags and braces, written as `&lt;`. */
export function escape_text_lt(value: string): string {
	if (!value.includes('<')) return value;
	let out = '';
	let depth = 0;
	let in_tag = false;
	for (let i = 0; i < value.length; i++) {
		const ch = value[i]!;
		if (ch === '{') depth++;
		else if (depth > 0) {
			if (ch === '}') depth--;
		} else if (in_tag) {
			if (ch === '>') in_tag = false;
		} else if (ch === '<') {
			const next = value[i + 1] ?? '';
			if (!TAG_START.test(next)) {
				out += '&lt;';
				continue;
			}
			in_tag = TAG_NAME_START.test(next);
		}
		out += ch;
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
