// A `<` in prose that starts no tag is text, as CommonMark reads it (`if the file is < 512KB`):
// the page compiles and shows the character. A real tag, a component and a `{…}` expression stay
// what they are.
import { compile } from 'svelte/compiler';
import { describe, expect, it } from 'vitest';
import { ogygiaPreprocess } from '../src/markdown/index.ts';

async function page(md: string): Promise<string> {
	const out = (await ogygiaPreprocess().markup!({ content: md, filename: '/app/a.md' })) as {
		code: string;
	};
	return out.code;
}

function compiles(code: string): void {
	expect(() => compile(code, { generate: 'server', filename: 'a.svelte' })).not.toThrow();
}

describe('a bare < in markdown prose', () => {
	it('before a space is text: the page compiles and shows it', async () => {
		const code = await page('Keep the GIF if it is < 512KB, else convert it.\n');
		compiles(code);
		expect(code).toContain('<p>Keep the GIF if it is &lt; 512KB, else convert it.</p>');
	});

	it('before a digit, or a letter with no closing >, is text too', async () => {
		const code = await page('I <3 this, and a <b and c too.\n');
		compiles(code);
		expect(code).toContain('<p>I &lt;3 this, and a &lt;b and c too.</p>');
	});

	it('a real tag, a component and an expression are left as they are', async () => {
		const code = await page('a <span>x</span> b < c {1 < 2} &lt; d\n');
		compiles(code);
		expect(code).toContain('<p>a <span>x</span> b &lt; c {1 < 2} &lt; d</p>');
	});

	it('inside a heading and a list item', async () => {
		const code = await page('## Sizes < 1 MB\n\n- under < 10\n');
		compiles(code);
		expect(code).toContain('Sizes &lt; 1 MB');
		expect(code).toContain('<li>under &lt; 10</li>');
	});
});
