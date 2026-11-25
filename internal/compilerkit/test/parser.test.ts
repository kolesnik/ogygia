/**
 * One parser: the kit parses with the oxc that Vite bundles (rolldown's), the one @ogygia/compiler
 * parses app code with, so ogygia's build loads one oxc and both read the same tree.
 */
import { parseSync as vite_parse } from 'vite';
import { expect, test } from 'vitest';
import { parseSync } from '../src/oxc.ts';

test("the kit's parser is the one Vite bundles", () => {
	expect(parseSync).toBe(vite_parse);
});
