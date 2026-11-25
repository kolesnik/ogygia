/**
 * EVERY MESSAGE THE IMAGE PLUGIN PRINTS, in one place: its code, its wording, what to do about it.
 *
 *   throw new OgygiaError('image_not_found', { file, src });
 *
 * The plugin and the image endpoint run in Node, never in a page, so the wording always prints, then
 * the code's page. What `<Img>` itself says lives in ./render-messages.ts (it can run in a page).
 *
 * @packageDocumentation
 */
import { define_messages, prose, type MessagesOf } from '@ogygia/core/internal/messages';

/** `<Img>`'s own errors, for the docs' message pages. */
export { IMAGE_RENDER_ERRORS } from './render-messages.ts';

/** The errors: `throw new OgygiaError(code, args)`. */
export const IMAGE_ERRORS = {
	image_outside_src: {
		text: (a: { file: string; src: string }): string => prose`
			${a.file}: an image must sit under ${a.src}/, outside src/lib/server/ and test files, for the
			image endpoint to read it.
		`,
		details: (): string => prose`
			Files are made from an image when a page asks for them, by the server, which reads the
			original with Kit's \`read()\`. Kit can only read an asset its server bundle carries; the
			image plugin makes every image under \`src/\` one of them, except \`src/lib/server/\` (never
			published) and test files (\`*.test.*\`, \`*.spec.*\`, \`__tests__/\`). Move the file under
			\`src/\` (a \`$lib\` folder, or beside the page or document that shows it).
		`
	},
	image_no_kit: {
		text: (): string => prose`
			image() found no SvelteKit config in this Vite build: list \`sveltekit()\` in vite.config's
			plugins, after \`image()\`.
		`,
		details: (): string => prose`
			The image plugin serves files under the app's base path and asset folder, which it reads
			from SvelteKit's own Vite plugin. Without SvelteKit there is no server to make the files
			and no paths to name them by.
		`
	},
	image_warm_unknown: {
		text: (a: { where: string; preset: string; known: string }): string => prose`
			${a.where}: warm names the preset '${a.preset}', which image({ presets }) does not declare.
			Declared: ${a.known}.
		`,
		details: (): string => prose`
			\`import.meta.og.image('./hero.jpg', { warm: 'cover' })\` makes the files of the \`cover\`
			preset at build, so a server-rendered page finds them ready. The name must be one of the
			presets in vite.config: a misspelled one would warm nothing, and the first visitor would
			wait for every file.
		`
	},
	image_unsettled: {
		text: (a: { url: string; reason: string }): string =>
			`a prerendered page names the image ${a.url}, which the build could not make (${a.reason}).`,
		details: (): string => prose`
			Every image file a prerendered page names (in its markup, or through \`layOut()\` in a CSS
			background) is made by the build, so a static host serves it with no server. This one
			failed: its original could not be read from the build output, or the encoder (sharp) could
			not decode it. The build stops rather than ship a page with a missing image.
		`
	},
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
	image_decode_failed: {
		text: (a: { file: string; reason: string }): string =>
			`${a.file}: the image could not be read (${a.reason}).`,
		details: (): string => prose`
			The encoder (sharp) could not decode the file: it may be damaged, empty, or in a format it
			does not read (AVIF, WebP, PNG, JPEG, GIF, TIFF and SVG are read).
		`
	}
};

/** The warnings: `warn(code, args)`. */
export const IMAGE_WARNINGS = {
	image_settle_failed: {
		text: (a: { path: string; reason: string }): string =>
			`the image endpoint could not make ${a.path} (${a.reason}); it answered 500.`,
		details: (): string => prose`
			A page asked for a file its signed URL describes, and making it failed: the original could
			not be read (Kit's \`read()\`), or the encoder (sharp) could not decode or write it. The page
			keeps its placeholder. In a prerender the 500 fails the build, naming the page that asked.
		`
	},
	image_no_encoder: {
		text: (a: { reason: string }): string =>
			`this server cannot make image files: the encoder (sharp) did not load (${a.reason}); image requests answer 500.`,
		details: (): string => prose`
			Image files are made by sharp, a native Node module. A runtime without it (an edge or
			Workers runtime, an install that skipped sharp's binary) cannot make them. Prerender the
			pages that show images (their files are made at build), warm the presets server-rendered
			pages use (\`import.meta.og.image(src, { warm: 'cover' })\`), or deploy to a Node server.
		`
	},
	image_adapter_no_encoder: {
		text: (a: { adapter: string }): string => prose`
			${a.adapter} runs the app where the image encoder (sharp) cannot load: a server-rendered page's
			images will answer 500 unless the page is prerendered or its preset warmed.
		`,
		details: (): string => prose`
			The image endpoint makes a file the first time a page asks for it, with sharp, a native Node
			module. This adapter's runtime has no native modules. Files of prerendered pages and of
			warmed presets (\`import.meta.og.image(src, { warm: 'cover' })\`) are made at build and served
			as static files, so those work everywhere.
		`
	},
	image_store_write_failed: {
		text: (a: { dir: string; reason: string }): string =>
			`the image file store ${a.dir} could not keep a file (${a.reason}): files are answered, and kept in memory instead.`,
		details: (): string => prose`
			The image endpoint keeps each file it made on disk, so the next ask, and the next start,
			reads it instead of making it again. Writing there failed: a full disk, a folder that is
			read-only, or a quota. The file was still answered. Until the store can write again, the
			server keeps the files it made in a small memory cache (the least recently asked go first)
			and makes the others again on the next ask. Free space in the temporary folder, or make it
			writable.
		`
	},
	image_busy: {
		text: (a: { waiting: number }): string =>
			`the image endpoint has ${a.waiting} files waiting to be made: it answers 503 (retry-after) until the line is shorter.`,
		details: (): string => prose`
			A live server makes a few files at once and queues a bounded number more, so a burst of
			asks for new files (a page of many images on a cold server, or a client asking for many
			URLs) cannot hold unbounded memory and CPU. Past that line, an ask is answered 503 with a
			\`retry-after\`, which no cache keeps; the browser shows the placeholder, and the next visit
			gets the file. Warm the presets your server-rendered pages use
			(\`import.meta.og.image(src, { warm: 'cover' })\`), or put a CDN in front, which asks once
			per file.
		`
	},
	image_store_unsafe: {
		text: (a: { dir: string }): string =>
			`the image file store ${a.dir} is not a folder only this user owns: files are made on every ask, and not kept.`,
		details: (): string => prose`
			A live server keeps the files it made under the system's temporary folder, in a folder only
			its user can read and write. Another user's folder, or a link, at that place could hand out
			files it chose, under URLs browsers keep forever, so the server keeps nothing there. Remove
			the folder, or run the server as the user that owns it.
		`
	}
};

type Own = MessagesOf<typeof IMAGE_ERRORS, typeof IMAGE_WARNINGS>;
const own: Own = define_messages(IMAGE_ERRORS, IMAGE_WARNINGS);
/** `throw new OgygiaError(code, args)`. */
export const OgygiaError: Own['OgygiaError'] = own.OgygiaError;
/** `warn(code, args)`. */
export const warn: Own['warn'] = own.warn;
