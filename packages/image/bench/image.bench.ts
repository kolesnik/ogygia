// The image package's hot paths: laying out a page of images (every `<Img>` render on the server
// calls lay_out and placeholder_style), the markdown rewrite of a long post (the rehype step over
// its tree, then `finish` over mdsvex's output with a frontmatter cover), the macro over a module
// with many calls, and the option checks and width ladder the plugin runs per image.
//
// Inputs are generated: descriptors shaped like the encoder's, a post tree shaped like
// mdast-util-to-hast's, empty image files in a fixed scratch folder (the macro and markdown check
// each file exists; their bytes are never read). The markdown extension is made in setup: making it
// hashes the package's own files once per process.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { bench } from '@bench/heisenbench/bench';
import { isImage, type ImageDescriptor, type ImageFormat } from '../src/descriptor.ts';
import { lay_out, mime_of, type ImageLayout } from '../src/layout.ts';
import { placeholder_style } from '../src/placeholder.ts';
import { image_call_edits, options_of_query, image_specifier } from '../src/vite/macro.ts';
import { markdown_extension } from '../src/vite/markdown.ts';
import {
	check_image_options,
	check_plugin_options,
	DEFAULT_BREAKPOINTS,
	ladder
} from '../src/vite/options.ts';

const DIR = path.join(os.tmpdir(), 'og-image-bench');
const QUERY_RE = /\?(og-image=[^"]+)/g;

/** `n` empty image files in the scratch folder, named `img-<i>.jpg`. */
function files(n: number): void {
	fs.mkdirSync(DIR, { recursive: true });
	for (let i = 0; i < n; i++) {
		const f = path.join(DIR, `img-${i}.jpg`);
		if (!fs.existsSync(f)) fs.writeFileSync(f, '');
	}
}

/** A descriptor as the encoder makes one: AVIF and WebP over the default ladder. */
function descriptor(i: number): ImageDescriptor {
	const width = 1200 + (i % 5) * 400;
	const height = Math.round((width * 9) / 16);
	const widths = ladder(width, DEFAULT_BREAKPOINTS, undefined);
	const formats: ImageFormat[] = ['avif', 'webp'];
	return {
		id: `img-${i}`,
		width,
		height,
		ph: 'data:image/webp;base64,UklGRkAAAABXRUJQVlA4IDQAAADQAQCdASoQAAkAAUAmJaQAA3AA/v89WAAA',
		variants: formats.flatMap((format) =>
			widths.map((w) => ({ src: `/_app/immutable/assets/img-${i}-${w}.${format}`, format, width: w }))
		)
	};
}

const LAYOUTS: ReadonlyArray<{ layout: ImageLayout; width?: number; height?: number }> = [
	{ layout: 'fullWidth' },
	{ layout: 'constrained', width: 720 },
	{ layout: 'constrained' },
	{ layout: 'fixed', width: 48, height: 48 },
	{ layout: 'constrained', width: 400, height: 400 }
];

bench(
	'lay_out: a page of forty images over every layout, with their placeholders',
	({ images }) => {
		let n = 0;
		for (let i = 0; i < images.length; i++) {
			const d = images[i]!;
			if (!isImage(d)) continue;
			const laid = lay_out(d, LAYOUTS[i % LAYOUTS.length]!);
			n += laid.src.length + (laid.srcset?.length ?? 0) + laid.sources.length;
			n += placeholder_style(d.ph).length + mime_of(d.variants[0]!.format).length;
		}
		return n;
	},
	{
		setup: () => ({ images: Array.from({ length: 40 }, (_, i) => descriptor(i)) }),
		scale: (_ctx, k) => ({ images: Array.from({ length: 40 * k }, (_, i) => descriptor(i)) })
	}
);

type Hast = {
	type: string;
	tagName?: string;
	value?: string;
	properties?: Record<string, unknown>;
	children?: Hast[];
};

/** A post's tree: paragraphs of text, every third holding a local image. */
function post_tree(paragraphs: number): Hast {
	const children: Hast[] = [];
	for (let i = 0; i < paragraphs; i++) {
		const text: Hast = { type: 'text', value: `Paragraph ${i} of the post, in plain words.` };
		const img: Hast = {
			type: 'element',
			tagName: 'img',
			properties: { src: `./img-${i % 12}.jpg`, alt: `Figure ${i}`, title: `A "title" ${i}` }
		};
		children.push({
			type: 'element',
			tagName: 'p',
			children: i % 3 === 0 ? [text, img] : [text]
		});
	}
	return { type: 'root', children };
}

/** mdsvex's module script for a post with a cover, then its body. */
function compiled(body: string): string {
	const meta = JSON.stringify({
		title: 'A post',
		cover: './img-0.jpg',
		tags: ['a', 'b'],
		gallery: [{ src: './img-1.jpg' }, { src: 'not-an-image' }]
	});
	return `<script context="module">\n\texport const metadata = ${meta};\n</script>\n${body}`;
}

bench(
	'markdown images: the rehype step over a sixty-paragraph post, then finish with a frontmatter cover',
	({ paragraphs, post, ext }) => {
		const tree = post_tree(paragraphs);
		ext.rehype[0].plugin()(tree, { filename: post });
		let body = '';
		const walk = (n: Hast): void => {
			if (n.type === 'raw') body += n.value;
			n.children?.forEach(walk);
		};
		walk(tree);
		const done = ext.finish(compiled(body), post);
		return done.code.length + done.lines.length;
	},
	{
		setup: () => {
			files(12);
			const ext = markdown_extension({ markdown: { width: 720 } })!;
			return { paragraphs: 60, post: path.join(DIR, '+post.md'), ext };
		},
		scale: (ctx, k) => ({ ...ctx, paragraphs: 60 * k })
	}
);

/** A module with `calls` image calls (every fourth with options) and a glob. */
function module_source(calls: number): string {
	let src = `import { thing } from './thing';\n`;
	for (let i = 0; i < calls; i++)
		src +=
			i % 4 === 0
				? `export const a${i} = import.meta.og.image('./img-${i % 12}.jpg', { quality: 70, width: 600, ops: { aspect: 16 / 9 } });\n`
				: `export const a${i} = import.meta.og.image('./img-${i % 12}.jpg');\n`;
	return src;
}

bench(
	'image macro: a module with twenty-four image calls, read and rewritten as edits',
	({ src, id }) => {
		const edits = image_call_edits(src, id);
		let n = edits.length;
		for (const e of edits)
			for (const m of e.text.matchAll(QUERY_RE)) n += Object.keys(options_of_query(m[1]!)).length;
		return n;
	},
	{
		setup: () => {
			files(12);
			return { src: module_source(24), id: path.join(DIR, 'page.ts') };
		},
		scale: (ctx, k) => ({ ...ctx, src: module_source(24 * k) })
	}
);

bench(
	'image options: the plugin options, then each image’s options, specifier and width ladder',
	({ images }) => {
		const plugin = check_plugin_options({
			quality: 70,
			formats: ['avif', 'webp'],
			breakpoints: [320, 640, 960, 1280, 1920],
			markdown: { width: 720 }
		});
		let n = plugin.breakpoints?.length ?? 0;
		for (let i = 0; i < images; i++) {
			const own = check_image_options(`page.ts:${i}`, {
				quality: 50 + (i % 40),
				width: 300 + i * 10,
				ops: { aspect: i % 2 ? '16/9' : 4 / 3, position: 'attention', grayscale: i % 3 === 0 }
			});
			n += image_specifier(`./img-${i}.jpg`, own).length;
			n += ladder(1600 + i * 20, plugin.breakpoints ?? DEFAULT_BREAKPOINTS, own.width).length;
		}
		return n;
	},
	{ setup: () => ({ images: 40 }), scale: (_ctx, k) => ({ images: 40 * k }) }
);
