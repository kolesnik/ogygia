/**
 * EVERY MESSAGE THE IMAGE PLUGIN PRINTS, in one place: its code, its wording, what to do about it.
 *
 *   throw new OgygiaError('image_not_found', { file, src });
 *
 * The plugin runs in Node, never in a page, so the wording always prints, then the code's page.
 *
 * @packageDocumentation
 */
import { define_messages, prose, type MessagesOf } from '@ogygia/core/internal/messages';

/** The errors: `throw new OgygiaError(code, args)`. */
export const IMAGE_ERRORS = {
	image_macro_arity: {
		text: (a: { file: string; line: number }): string =>
			`${a.file}:${a.line} — import.meta.og.image(src, options?) takes a path and, at most, an options object.`,
		details: (): string => prose`
			\`import.meta.og.image\` reads one image file at build time:
			\`import.meta.og.image('./hero.jpg')\`, or with options,
			\`import.meta.og.image('./hero.jpg', { quality: 70 })\`.
		`
	},
	image_macro_not_literal: {
		text: (a: { file: string; line: number; what: string }): string => prose`
			${a.file}:${a.line} — import.meta.og.image(): ${a.what} must be written out in place (a string
			literal path, an object literal of plain values).
		`,
		details: (): string => prose`
			The build reads the call before any code runs, so the path and options must be literals:
			no variables, no template strings with \`\${…}\`, no function calls. To pick an image at run
			time, make every candidate at build (\`import.meta.og.image.glob('./gallery/*.jpg')\`) and
			choose among the results.
		`
	},
	image_macro_in_markup: {
		text: (a: { file: string }): string => prose`
			${a.file}: import.meta.og.image() is called in the template. Call it in the component's
			<script> and use the result in the markup.
		`,
		details: (): string => prose`
			The build reads image calls from a component's script. A call in the markup would be left
			as it is and fail when the page renders, so the build stops here instead:
			\`const hero = import.meta.og.image('./hero.jpg');\` in the script, then
			\`<Img of={hero} alt="…" />\`.
		`
	},
	image_query_invalid: {
		text: (a: { query: string }): string =>
			`the og-image query '?${a.query}' does not hold the options import.meta.og.image() writes.`,
		details: (): string => prose`
			The \`og-image\` query is written by the image macro, its options encoded inside. Import
			images through \`import.meta.og.image('./x.jpg', { … })\` instead of writing the query by
			hand.
		`
	},
	image_remote_unsupported: {
		text: (a: { file: string; src: string }): string => prose`
			${a.file}: import.meta.og.image('${a.src}') — remote images are not supported yet. Download the
			file into the project, or render a plain \`<img>\` for it.
		`,
		details: (): string => prose`
			This version encodes files that are part of the app. A URL on another host would need fetching
			at build and an allowlist of hosts; that is planned, not built.
		`
	},
	image_not_found: {
		text: (a: { file: string; src: string }): string =>
			`${a.file}: the image '${a.src}' does not exist (paths are relative to this file).`,
		details: (): string => prose`
			An image path resolves against the file that names it, like an import. Check the spelling and
			the folder, and that the file is committed.
		`
	},
	image_markdown_no_file: {
		text: (a: { src: string }): string => prose`
			markdown with no file of its own (\`import.meta.og.md(text)\`) names the local image
			'${a.src}', which has nothing to resolve against.
		`,
		details: (): string => prose`
			A local image in markdown resolves against the markdown file, like an import. Markdown
			rendered from a string has no file, so there is nowhere to look. Use a site-absolute or
			remote URL there (\`/images/x.png\`), or move the markdown into a \`.md\` file beside the
			image.
		`
	},
	image_path_malformed: {
		text: (a: { file: string; src: string }): string =>
			`${a.file}: the image path '${a.src}' could not be decoded (a %-escape that is not UTF-8).`,
		details: (): string => prose`
			Markdown writes an image path as a URL, so a space is \`%20\` and an accent is its UTF-8
			bytes, like \`%C3%A9\`. This path has an escape that does not decode to text. Write the file
			name as it is (\`![](<./my photo.jpg>)\`), or escape it as UTF-8.
		`
	},
	image_markdown_html: {
		text: (a: { file: string; src: string }): string => prose`
			${a.file}: <img src="${a.src}"> in markdown HTML names a local file, which would ship as a
			broken link. Write it as ![alt](${a.src}).
		`,
		details: (): string => prose`
			A markdown image (\`![alt](./x.jpg)\`) is encoded at build and rendered through \`<Img>\`. An
			HTML \`<img>\` is copied as text, so its relative path points at nothing once the page is
			served. Use the markdown form, or put the file in \`static/\` and name it from the site root.
		`
	},
	image_glob_empty: {
		text: (a: { file: string; pattern: string }): string =>
			`${a.file}: import.meta.og.image.glob('${a.pattern}') matched no file.`,
		details: (): string => prose`
			An empty gallery is almost always a wrong pattern, so the build stops instead of rendering
			nothing. Patterns resolve against the file that names them.
		`
	},
	image_option_unknown: {
		text: (a: { where: string; key: string; known: string }): string =>
			`${a.where}: unknown image option '${a.key}'. Known: ${a.known}.`,
		details: (): string => prose`
			A misspelled option would otherwise be ignored and the image encoded the default way.
		`
	},
	image_option_invalid: {
		text: (a: { where: string; key: string; rule: string }): string =>
			`${a.where}: image option '${a.key}' must be ${a.rule}.`,
		details: (): string => prose`
			The option has a value the encoder cannot use. The message names the rule it breaks.
		`
	},
	image_encode_dropped: {
		text: (a: { file: string; variant: string }): string =>
			`${a.file}: the encode of ${a.variant} was dropped before it finished.`,
		details: (): string => prose`
			The encode of one image file was given up while it ran (its build or dev server was closing).
			Run the build again; if it repeats, report it with the file.
		`
	},
	image_decode_failed: {
		text: (a: { file: string; reason: string }): string =>
			`${a.file}: the image could not be read (${a.reason}).`,
		details: (): string => prose`
			The encoder (sharp) could not decode the file: it may be damaged, empty, or in a format it
			does not read (AVIF, WebP, PNG, JPEG, GIF, TIFF and SVG are read).
		`
	}
};

/** The warnings. */
export const IMAGE_WARNINGS = {};

type Own = MessagesOf<typeof IMAGE_ERRORS, typeof IMAGE_WARNINGS>;
const own: Own = define_messages(IMAGE_ERRORS, IMAGE_WARNINGS);
/** `throw new OgygiaError(code, args)`. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
