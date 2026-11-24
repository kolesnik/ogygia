import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { BRIDGE, install_markdown_bridge, type ImageMarkdownBridge } from '../src/vite/markdown.ts';

type Hast = { type?: string; tagName?: string; value?: string; properties?: Record<string, unknown>; children?: Hast[] };

let dir: string;
let post: string;
beforeAll(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-md-'));
	for (const name of ['harbor.jpg', 'my photo.jpg', 'café.jpg', 'cover.jpg'])
		fs.writeFileSync(path.join(dir, name), '');
	post = path.join(dir, '+post.md');
});

function bridge(width?: number): ImageMarkdownBridge {
	install_markdown_bridge(width === undefined ? {} : { markdown: { width } });
	return (globalThis as { [BRIDGE]?: ImageMarkdownBridge })[BRIDGE]!;
}

/** A paragraph holding one markdown image, as mdast-util-to-hast hands it to rehype. */
function tree_of(properties: Record<string, unknown>): Hast {
	return {
		type: 'root',
		children: [
			{ type: 'element', tagName: 'p', children: [{ type: 'element', tagName: 'img', properties }] }
		]
	};
}

/** Run the rehype step, then `finish` on what it wrote: the body and the module-script lines. */
function compile(tree: Hast, b = bridge()): { body: string; lines: string[] } {
	b.rehype()(tree, { filename: post });
	const raws: string[] = [];
	const collect = (n: Hast): void => {
		if (n.type === 'raw') raws.push(n.value!);
		n.children?.forEach(collect);
	};
	collect(tree);
	const done = b.finish(raws.join('\n'), post);
	return { body: done.code, lines: done.lines };
}

describe('markdown body images', () => {
	test('a local image renders through <Og__Img>, imported under the og-image query', () => {
		const { body, lines } = compile(tree_of({ src: './harbor.jpg', alt: 'A harbor' }));
		expect(body).toContain('<Og__Img of={__og_md_image_0} alt="A harbor" />');
		expect(lines).toContain(`import Og__Img from '@ogygia/image/Img.svelte';`);
		expect(lines).toContain('import __og_md_image_0 from "./harbor.jpg?og-image";');
	});

	test('the prose width rides as the image width and as the encode width', () => {
		const { body, lines } = compile(tree_of({ src: 'harbor.jpg', alt: '' }), bridge(720));
		expect(body).toContain('width={720}');
		expect(lines.at(-1)).toMatch(/^import __og_md_image_0 from "\.\/harbor\.jpg\?og-image=[\w-]+";$/);
	});

	test('alt and title text cannot close the attribute or open an expression', () => {
		const { body } = compile(
			tree_of({ src: './harbor.jpg', alt: 'He said "hi" {x} <b>', title: 'a & b }' })
		);
		expect(body).toContain('alt="He said &quot;hi&quot; &#123;x&#125; &lt;b>"');
		expect(body).toContain('title="a &amp; b &#125;"');
	});

	test('a name with a space is imported by its real name, not its URL-encoded one', () => {
		const { lines } = compile(tree_of({ src: './my%20photo.jpg', alt: '' }));
		expect(lines).toContain('import __og_md_image_0 from "./my photo.jpg?og-image";');
	});

	test('a non-ASCII name is imported by its real name, not its URL-encoded one', () => {
		const { lines } = compile(tree_of({ src: './caf%C3%A9.jpg', alt: '' }));
		expect(lines).toContain('import __og_md_image_0 from "./café.jpg?og-image";');
	});

	test('a path whose escapes are not UTF-8 fails with a coded message, not a URIError', () => {
		expect(() => compile(tree_of({ src: './a%FF.jpg', alt: '' }))).toThrow(
			/image_path_malformed|could not be decoded/
		);
	});

	test('a missing local image fails the build, naming it', () => {
		expect(() => compile(tree_of({ src: './nope.jpg', alt: '' }))).toThrow(
			/'\.\/nope\.jpg' does not exist/
		);
	});

	test('a remote or site-absolute image is left as a plain <img>', () => {
		for (const src of ['https://example.com/a.jpg', '/static/a.jpg']) {
			const tree = tree_of({ src, alt: '' });
			bridge().rehype()(tree, { filename: post });
			expect(tree.children![0]!.children![0]!.tagName).toBe('img');
		}
	});
});
