/** The ambient declarations are what the macros say they are. */
import { readFileSync } from 'node:fs';
import { expect, test } from 'vitest';
import { DTS_FILE, macro_types } from '../src/types.ts';

test('macros.d.ts is fresh (node internal/macros/src/types.ts writes it)', () => {
	expect(readFileSync(DTS_FILE, 'utf8')).toBe(macro_types());
});
