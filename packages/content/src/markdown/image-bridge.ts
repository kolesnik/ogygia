/**
 * The bridge `@ogygia/image` puts up (`image()` beside `ogygia()`) so markdown images and frontmatter
 * image paths become descriptors. Read from a registered global symbol: neither package imports the
 * other, and with no image plugin listed there is no bridge and markdown images stay plain `<img>`.
 * The shape is the contract; `@ogygia/image`'s `src/vite/markdown.ts` is the other side.
 */

type HastNode = { type?: string; children?: HastNode[] };

/** What `@ogygia/image` offers the markdown pipeline. */
export interface ImageMarkdownBridge {
	/** What changes the compiled output: part of the document cache key. */
	key: string;
	/** A rehype plugin: local `<img>` → `<Og__Img>`. */
	rehype: () => (tree: HastNode, file: { path?: string; filename?: string }) => void;
	/** After mdsvex: frontmatter image paths → descriptors; the module-script lines to add, and
	 *  whether the body now renders a component. */
	finish: (
		code: string,
		filename: string
	) => { code: string; lines: string[]; components: boolean };
}

const BRIDGE: unique symbol = Symbol.for('ogygia.image.markdown');

/** The image plugin's bridge, when it is listed. */
export function image_bridge(): ImageMarkdownBridge | undefined {
	return (globalThis as { [BRIDGE]?: ImageMarkdownBridge })[BRIDGE];
}
