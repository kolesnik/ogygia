/**
 * Markdown images, for `@ogygia/content`: a local `![alt](./harbor.jpg)` renders through `<Img>`, and
 * a frontmatter value that is a path to a local image (`cover: ./cover.jpg`) becomes a descriptor.
 *
 * The two packages do not import each other. This plugin puts a bridge on a registered global symbol;
 * content's markdown preprocessor reads it at compile time and, when it is there, runs `rehype` inside
 * mdsvex and `finish` on mdsvex's output. With no image plugin listed there is no bridge, and
 * markdown images stay plain `<img>`.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { image_specifier } from './macro.ts';
import { OgygiaError } from '../messages.ts';
import type { ImagePluginOptions } from './options.ts';

/** The bridge content reads. Its shape is the contract between the two packages. */
export interface ImageMarkdownBridge {
	/** What changes the compiled output: part of content's document cache key. */
	key: string;
	/** A rehype plugin: local `<img>` elements → `<Og__Img>`. */
	rehype: () => (tree: HastNode, file: { path?: string; filename?: string }) => void;
	/** After mdsvex: frontmatter image paths → descriptors. Returns the module-script lines to add, and
	 *  whether the body now renders `<Og__Img>` (so it is a component, not static HTML). */
	finish: (
		code: string,
		filename: string
	) => { code: string; lines: string[]; components: boolean };
}

type HastNode = {
	type?: string;
	tagName?: string;
	value?: string;
	properties?: Record<string, unknown>;
	children?: HastNode[];
};

/** The global the bridge sits on. */
export const BRIDGE: unique symbol = Symbol.for('ogygia.image.markdown');

const IMAGE_EXT_RE = /\.(?:png|jpe?g|webp|avif|gif|svg|tiff?)$/i;
const NOT_LOCAL_RE = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i;
const IMPORTS_RE = /<!--og-image:([A-Za-z0-9_-]*)-->/;
const METADATA_RE = /export const metadata = (\{.*?\});(?=\s*(?:\n|<\/script>|$))/s;
const COMPONENT = 'Og__Img';

/** Is `src` a path to an image beside the file (not a URL, not a site-absolute path)? */
function is_local_image(src: string): boolean {
	return IMAGE_EXT_RE.test(src.split(/[?#]/)[0]!) && !NOT_LOCAL_RE.test(src);
}

/** Escape a value for a Svelte attribute in quotes: no expression braces, no closing quote. */
function attr(value: string): string {
	return value
		.replace(/&/g, '&amp;')
		.replace(/"/g, '&quot;')
		.replace(/\{/g, '&#123;')
		.replace(/\}/g, '&#125;')
		.replace(/</g, '&lt;');
}

function resolve_local(filename: string, src: string): string {
	const abs = path.resolve(path.dirname(filename), decodeURI(src.split(/[?#]/)[0]!));
	if (!fs.existsSync(abs))
		throw new OgygiaError('image_not_found', { file: path.basename(filename), src });
	return abs;
}

let code_hash: string | undefined;

/** A hash of this package's shipped code (`src` in the workspace, `dist` when installed): what
 *  content's markdown output depends on besides the options. Read once. */
function shipped_code(): string {
	if (code_hash !== undefined) return code_hash;
	let top = path.dirname(fileURLToPath(import.meta.url));
	while (!fs.existsSync(path.join(path.dirname(top), 'package.json'))) {
		const up = path.dirname(top);
		if (up === top) break;
		top = up;
	}
	const h = crypto.createHash('sha256');
	for (const rel of fs.readdirSync(top, { recursive: true, encoding: 'utf8' }).sort()) {
		const p = path.join(top, rel);
		if (!fs.statSync(p).isFile()) continue;
		h.update(rel);
		h.update('\0');
		h.update(fs.readFileSync(p));
		h.update('\0');
	}
	return (code_hash = h.digest('base64url').slice(0, 16));
}

/** Put the bridge up for content to find. One per process: the last `image()` wins. */
export function install_markdown_bridge(opts: ImagePluginOptions): void {
	const g = globalThis as { [BRIDGE]?: ImageMarkdownBridge };
	if (opts.markdown === false) {
		delete g[BRIDGE];
		return;
	}
	const width = opts.markdown?.width;
	const own = width !== undefined ? { width } : {};
	g[BRIDGE] = {
		key: `og-image:${shipped_code()}:${JSON.stringify(opts)}`,
		rehype: () => (tree, file) => {
			const filename = file.filename ?? file.path;
			if (!filename) return;
			const imports: [string, string][] = [];
			const visit = (node: HastNode): void => {
				const children = node.children;
				if (!children) return;
				for (let i = 0; i < children.length; i++) {
					const child = children[i]!;
					const src = child.properties?.src;
					if (
						child.type === 'element' &&
						child.tagName === 'img' &&
						typeof src === 'string' &&
						is_local_image(src)
					) {
						resolve_local(filename, src);
						const name = `__og_md_image_${imports.length}`;
						const spec = image_specifier(src.startsWith('.') ? src : `./${src}`, own);
						imports.push([name, spec]);
						const alt = typeof child.properties?.alt === 'string' ? child.properties.alt : '';
						const title = child.properties?.title;
						const extra = typeof title === 'string' ? ` title="${attr(title)}"` : '';
						const sized = width !== undefined ? ` width={${width}}` : '';
						children[i] = {
							type: 'raw',
							value: `<${COMPONENT} of={${name}} alt="${attr(alt)}"${extra}${sized} />`
						};
					} else visit(child);
				}
			};
			visit(tree);
			if (imports.length) {
				const payload = Buffer.from(JSON.stringify(imports)).toString('base64url');
				(tree.children ??= []).unshift({ type: 'raw', value: `<!--og-image:${payload}-->` });
			}
		},
		finish: (code, filename) => {
			const lines: string[] = [];
			const found = IMPORTS_RE.exec(code);
			if (found) {
				code = code.slice(0, found.index) + code.slice(found.index + found[0].length);
				const imports = JSON.parse(Buffer.from(found[1]!, 'base64url').toString('utf8')) as [
					string,
					string
				][];
				lines.push(`import ${COMPONENT} from '@ogygia/image/Img.svelte';`);
				for (const [name, spec] of imports)
					lines.push(`import ${name} from ${JSON.stringify(spec)};`);
			}
			const meta = METADATA_RE.exec(code);
			if (meta) {
				let data: unknown;
				try {
					data = JSON.parse(meta[1]!);
					// oxlint-disable-next-line ogygia/no-silent-failures -- not JSON: mdsvex wrote something else, and frontmatter images are only read from its JSON form
				} catch {
					return { code, lines, components: found !== null };
				}
				let n = 0;
				const names: string[] = [];
				const emit = (value: unknown): string => {
					if (typeof value === 'string' && is_local_image(value)) {
						resolve_local(filename, value);
						const name = `__og_fm_image_${n++}`;
						names.push(name);
						lines.push(
							`import ${name} from ${JSON.stringify(image_specifier(value.startsWith('.') ? value : `./${value}`))};`
						);
						return name;
					}
					if (Array.isArray(value)) return `[${value.map(emit).join(',')}]`;
					if (value !== null && typeof value === 'object')
						return `{${Object.entries(value)
							.map(([k, v]) => `${JSON.stringify(k)}:${emit(v)}`)
							.join(',')}}`;
					return JSON.stringify(value);
				};
				const js = emit(data);
				if (names.length)
					code =
						code.slice(0, meta.index) +
						`export const metadata = ${js};` +
						code.slice(meta.index + meta[0].length);
			}
			return { code, lines, components: found !== null };
		}
	};
}
