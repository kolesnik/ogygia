import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { boot_link, boot_link_or_null, init } from '../src/runtime/lazy-link.ts';

it('a lazy chunk that runs before the boot handed it its link says so loudly, by its code and the link', () => {
	// (this file's module graph: no boot handed it a link)
	expect(boot_link_or_null()).toBeNull();
	expect(() => boot_link()).toThrow('[ogygia] https://ogygiajs.dev/e/slot_not_linked?name=boot');
});

it('the lazy link holds what the boot hands it, the same list', () => {
	const link = [] as unknown as Parameters<typeof init>[0];
	init(link);
	expect(boot_link()).toBe(link);
	expect(boot_link_or_null()).toBe(link);
});

it('the lazy link imports no value: every lazy chunk and island code reach it', () => {
	const imports_of = (source: string) =>
		[...source.matchAll(/^import\s(?!type\b)[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
	// (the reader is not vacuous: it finds a value import, and skips a type-only one)
	expect(
		imports_of("import { a } from './a.ts';\nimport type { B } from '../messages/core.ts';")
	).toEqual(['./a.ts']);
	const source = readFileSync(new URL('../src/runtime/lazy-link.ts', import.meta.url), 'utf8');
	expect(imports_of(source)).toEqual([]);
});
