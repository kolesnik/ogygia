/** Other modules: a source file by its import path, a reading cached by text, relative imports. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { Report, parse, resolveSpecifier } from '../src/index.ts';
import { fileCache, relativeImports, sourceOf } from '../src/modules.ts';

const dir = mkdtempSync(join(tmpdir(), 'compilerkit-modules-'));
writeFileSync(join(dir, 'a.ts'), 'export const a = 1\n');

describe('sourceOf', () => {
	test('the path, else with .ts, else null', () => {
		expect(sourceOf(join(dir, 'a.ts'))).toBe(join(dir, 'a.ts'));
		expect(sourceOf(join(dir, 'a'))).toBe(join(dir, 'a.ts'));
		expect(sourceOf(join(dir, 'none'))).toBeNull();
	});
});

describe('fileCache', () => {
	test('made once per text, again when the text changes', () => {
		let made = 0;
		const read = fileCache((_path, code) => {
			made++;
			return code.length;
		});
		writeFileSync(join(dir, 'b.ts'), 'x');
		expect(read(join(dir, 'b'))).toBe(1);
		expect(read(join(dir, 'b.ts'))).toBe(1);
		expect(made).toBe(1);
		writeFileSync(join(dir, 'b.ts'), 'xyz');
		expect(read(join(dir, 'b'))).toBe(3);
		expect(made).toBe(2);
		expect(read(join(dir, 'none'))).toBeNull();
	});
});

describe('relativeImports', () => {
	const source = `import { a, b as c } from './a.ts'
import type { T } from './t.ts'
import { type U, v } from '../u.ts'
import { w } from 'package'
import x from './x.ts'`;
	const program = parse(source, new Report(source, 'x.ts'));
	test('local name to the module and the name it exports', () => {
		const all = relativeImports('/p/q/x.ts', program);
		expect(Object.fromEntries(all)).toEqual({
			a: { from: '/p/q/a.ts', name: 'a' },
			c: { from: '/p/q/a.ts', name: 'b' },
			T: { from: '/p/q/t.ts', name: 'T' },
			U: { from: '/p/u.ts', name: 'U' },
			v: { from: '/p/u.ts', name: 'v' }
		});
	});
	test('values only leaves type imports out', () => {
		expect([...relativeImports('/p/q/x.ts', program, { values: true }).keys()]).toEqual([
			'a',
			'c',
			'v'
		]);
	});
});

describe('resolveSpecifier', () => {
	test('a relative path, or an alias of the file’s own package; a package is not followed', () => {
		const pkg = mkdtempSync(join(tmpdir(), 'compilerkit-specifier-'));
		mkdirSync(join(pkg, 'src/a/deep'), { recursive: true });
		writeFileSync(
			join(pkg, 'package.json'),
			JSON.stringify({
				imports: {
					'#a/*': './src/a/*',
					'#layout.gen.ts': './src/layout.gen.ts'
				}
			})
		);
		const from = join(pkg, 'src/a/deep/x.ts');
		expect(resolveSpecifier(from, '../y.ts')).toBe(join(pkg, 'src/a/y.ts'));
		expect(resolveSpecifier(from, '#a/deep/z.ts')).toBe(join(pkg, 'src/a/deep/z.ts'));
		expect(resolveSpecifier(from, '#layout.gen.ts')).toBe(join(pkg, 'src/layout.gen.ts'));
		expect(resolveSpecifier(from, '#b/z.ts')).toBeNull();
		expect(resolveSpecifier(from, 'compilerkit')).toBeNull();
	});

	test('an alias whose target depends on the build (conditions) is not followed, and never throws', () => {
		const pkg = mkdtempSync(join(tmpdir(), 'compilerkit-specifier-'));
		mkdirSync(join(pkg, 'src'), { recursive: true });
		writeFileSync(
			join(pkg, 'package.json'),
			JSON.stringify({
				imports: {
					'#twin': { browser: './src/twin.browser.ts', default: './src/twin.ts' },
					'#plain': './src/plain.ts'
				}
			})
		);
		const from = join(pkg, 'src/x.ts');
		expect(resolveSpecifier(from, '#twin')).toBeNull();
		expect(resolveSpecifier(from, '#plain')).toBe(join(pkg, 'src/plain.ts'));
	});
});
