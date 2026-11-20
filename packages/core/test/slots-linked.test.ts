import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { router_link, slots } from '../src/runtime/slots.ts';

it('a lazy chunk that runs before its boot linked it says so loudly, by its code and the link', () => {
	const kept = slots.router_link;
	slots.router_link = null;
	try {
		expect(() => router_link()).toThrow(
			'[ogygia] https://ogygiajs.dev/e/slot_not_linked?name=router_link'
		);
	} finally {
		slots.router_link = kept;
	}
});

it('the slot registry imports no messages module: every chunk imports the registry', () => {
	const imports_of = (source: string) =>
		[...source.matchAll(/^import\s(?!type\b)[^;]*?from\s+'([^']+)'/gm)].map((m) => m[1]);
	// (the reader is not vacuous: it finds a value import, and skips a type-only one)
	expect(
		imports_of("import { a } from './a.ts';\nimport type { B } from '../messages/core.ts';")
	).toEqual(['./a.ts']);
	const source = readFileSync(new URL('../src/runtime/slots.ts', import.meta.url), 'utf8');
	for (const from of imports_of(source)) expect(from, from).not.toMatch(/messages/);
});
