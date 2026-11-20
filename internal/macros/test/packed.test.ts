/**
 * A packed package carries no macro: none left in its JavaScript, none named in its declarations,
 * and no macro package among its dependencies.
 */
import { describe, expect, test } from 'vitest';
import { packed_problems } from '../src/packed.ts';

const NAMES = ['$dev', '$await'];

describe('a packed package', () => {
	test('a macro left in JavaScript is refused; one in a string, or a member, is no use', () => {
		expect(
			packed_problems(
				[
					{ path: 'dist/a.js', text: 'const f = $dev(function f() {})' },
					{ path: 'dist/b.js', text: "const s = '$dev'; o.$dev(); const p = { $dev: 1 }" }
				],
				{},
				NAMES
			)
		).toEqual(['dist/a.js: $dev is a macro, left uncompiled.']);
	});

	test('a declaration that names a macro is refused, by line', () => {
		expect(
			packed_problems(
				[
					{
						path: 'dist/a.d.ts',
						text: 'export declare const a: 1;\nexport declare const b: typeof $await;'
					}
				],
				{},
				NAMES
			)
		).toEqual(['dist/a.d.ts:2: `$await` is a macro: it exists only at build time.']);
	});

	test('a macro package among the dependencies is refused', () => {
		expect(
			packed_problems([], {
				dependencies: { 'ogygia-internal-macros': 'workspace:*', devalue: '1' },
				peerDependencies: { 'ogygia-internal-compilerkit': '*' }
			})
		).toEqual([
			'package.json: dependencies names ogygia-internal-macros, a build tool: no compiler ships.',
			'package.json: peerDependencies names ogygia-internal-compilerkit, a build tool: no compiler ships.'
		]);
	});

	test('a JavaScript file that does not parse is said, not skipped', () => {
		expect(packed_problems([{ path: 'dist/a.js', text: 'const = $dev(' }], {}, NAMES)[0]).toMatch(
			/^dist\/a\.js: does not parse/
		);
	});
});
