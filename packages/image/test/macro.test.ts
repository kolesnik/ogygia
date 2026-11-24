import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { beforeAll, describe, expect, test } from 'vitest';
import { dedent } from '@ogygia/core/plugin/utils';
import { options_of_query, rewrite_image_calls } from '../src/vite/macro.ts';

let dir: string;
beforeAll(() => {
	dir = fs.mkdtempSync(path.join(os.tmpdir(), 'og-image-macro-'));
	fs.writeFileSync(path.join(dir, 'hero.jpg'), '');
	fs.mkdirSync(path.join(dir, 'gallery'));
	fs.writeFileSync(path.join(dir, 'gallery', '01-a.jpg'), '');
	fs.writeFileSync(path.join(dir, 'gallery', '02-b.jpg'), '');
});

const mod = () => path.join(dir, 'page.ts');

describe('rewrite_image_calls', () => {
	test('a call becomes an import of the file under the og-image query', () => {
		const out = rewrite_image_calls(`const hero = import.meta.og.image('./hero.jpg');\n`, mod());
		expect(out).toContain(`import __og_image_0 from "./hero.jpg?og-image";`);
		expect(out).toContain('const hero = __og_image_0;');
	});

	test('options travel in the query, read back as written', () => {
		const out = rewrite_image_calls(
			`const hero = import.meta.og.image('./hero.jpg', { quality: 70, ops: { aspect: 16 / 9, grayscale: true } });`,
			mod()
		);
		const q = /\?(og-image=[^"]+)/.exec(out)![1]!;
		expect(options_of_query(q)).toEqual({ quality: 70, ops: { aspect: 16 / 9, grayscale: true } });
	});

	test('in a component the import lands in the script that calls', () => {
		const src = `${dedent`
			<script lang="ts">
				const hero = import.meta.og.image('./hero.jpg') as const;
			</script>
			<p>x</p>
		`}\n`;
		const out = rewrite_image_calls(src, path.join(dir, 'Page.svelte'));
		expect(out).toMatch(
			/^<script lang="ts">\nimport __og_image_0 from "\.\/hero\.jpg\?og-image";\n/
		);
		expect(out).toContain('<p>x</p>');
	});

	test('glob becomes an eager import.meta.glob under the query', () => {
		const out = rewrite_image_calls(
			`const g = import.meta.og.image.glob('./gallery/*.jpg');`,
			mod()
		);
		expect(out).toBe(
			`const g = import.meta.glob("./gallery/*.jpg", { eager: true, import: 'default', query: "?og-image" });`
		);
	});

	test('a glob that matches nothing fails the build', () => {
		expect(() => rewrite_image_calls(`import.meta.og.image.glob('./nope/*.jpg');`, mod())).toThrow(
			/matched no file/
		);
	});

	test('a missing file fails the build, naming it', () => {
		expect(() => rewrite_image_calls(`import.meta.og.image('./missing.jpg');`, mod())).toThrow(
			/missing\.jpg' does not exist/
		);
	});

	test('a variable path fails: the build reads literals', () => {
		expect(() => rewrite_image_calls(`import.meta.og.image(name);`, mod())).toThrow(
			/must be written out in place/
		);
	});

	test('a misspelled option fails instead of being ignored', () => {
		expect(() =>
			rewrite_image_calls(`import.meta.og.image('./hero.jpg', { qualty: 70 });`, mod())
		).toThrow(/unknown image option 'qualty'/);
	});

	test('a remote URL fails with what to do instead', () => {
		expect(() =>
			rewrite_image_calls(`import.meta.og.image('https://example.com/a.jpg');`, mod())
		).toThrow(/remote images are not supported yet/);
	});

	test('a hand-written og-image query that is not the macro’s fails with its code', () => {
		expect(() => options_of_query('og-image=not-json')).toThrow(/og-image query/);
	});

	test('a call in a component template fails the build instead of shipping as code', () => {
		const svelte = path.join(dir, 'Card.svelte');
		for (const call of [
			`import.meta.og.image('./hero.jpg')`,
			`import.meta.og.image.glob('./gallery/*.jpg')`
		]) {
			const src = dedent`
				<script>let a = 1;</script>
				<p>{${call}}</p>
			`;
			expect(() => rewrite_image_calls(src, svelte)).toThrow(/in the template/);
		}
	});

	test('the words in a component template’s text are not a call', () => {
		const svelte = path.join(dir, 'Doc.svelte');
		const src = '<p>Use import.meta.og.image to read a file.</p>\n';
		expect(rewrite_image_calls(src, svelte)).toBe(src);
	});

	test('a module without the marker is returned as it is', () => {
		const src = 'const x = 1;';
		expect(rewrite_image_calls(src, mod())).toBe(src);
	});
});
