/**
 * Ambient types from a signatures module, through TypeScript's own declaration emit: every export
 * a global, the types they lean on beside them; the macros and the exports must agree.
 */
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { ambientTypes } from '../src/index.ts';

const signatures = fileURLToPath(new URL('./fixtures/signatures.ts', import.meta.url));
const header = ['Generated: do not edit.'];

describe('ambient types', () => {
	test('the exports become globals; the module doc stays out', () => {
		expect(
			ambientTypes({
				signatures,
				header,
				macros: [{ names: ['$twice'] }, { names: ['$geo'] }]
			})
		).toMatchSnapshot();
	});

	test('a macro without a signature, or an export no macro owns, is an error', () => {
		expect(() =>
			ambientTypes({
				signatures,
				header,
				macros: [{ names: ['$twice', '$geo', '$more'] }]
			})
		).toThrow('the macro name `$more` has no signature');
		expect(() => ambientTypes({ signatures, header, macros: [{ names: ['$twice'] }] })).toThrow(
			'exports `$geo`, which no macro owns.'
		);
	});
});

describe('ambient types that import', () => {
	const importing = fileURLToPath(new URL('./fixtures/importing.ts', import.meta.url));

	test('an import is rewritten from where the ambient file goes', () => {
		const out = ambientTypes({
			signatures: importing,
			output: fileURLToPath(new URL('./fixtures/out/macros.d.ts', import.meta.url)),
			header,
			macros: [{ names: ['$mid'] }]
		});
		expect(out).toContain("import type { Point } from '../lib/point.ts'");
		expect(out).toContain('function $mid(a: Point, b: Point): Point');
	});

	test('without `output`, an import is an error', () => {
		expect(() =>
			ambientTypes({
				signatures: importing,
				header,
				macros: [{ names: ['$mid'] }]
			})
		).toThrow('say where the ambient file goes');
	});
});
