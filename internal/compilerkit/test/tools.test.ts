/**
 * The kit's other tools: named steps, committed generated modules, build-only shortening,
 * generated declarations and the check of published ones, and the build plugin.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import {
	declarations,
	dts,
	macroPlugin,
	notSource,
	pipeline,
	publishedTypes,
	shortNames,
	shorten,
	step,
	writeGenerated
} from '../src/index.ts';

describe('pipeline', () => {
	test('runs its steps in order, typed from one to the next', () => {
		const compile = pipeline(
			step('split', (text: string) => text.split(',')),
			step('count', (parts: Array<string>) => parts.length),
			step('say', (n: number) => `${n} parts`)
		);
		expect(compile.name).toBe('split → count → say');
		expect(compile.run('a,b,c')).toBe('3 parts');
	});
});

describe('generated modules', () => {
	test('written, then fresh; a changed, missing or extra owned file is stale', () => {
		const root = mkdtempSync(join(tmpdir(), 'kit-'));
		const modules = [{ path: 'a/a.gen.ts', code: 'export const a = 1\n' }];
		const upper = (codes: ReadonlyArray<string>) => codes.map((code) => code.toUpperCase());
		const owned = (path: string) => path.endsWith('.gen.ts');
		expect(writeGenerated(root, modules, { check: false, owned })).toEqual(['a/a.gen.ts']);
		expect(writeGenerated(root, modules, { check: true, owned })).toEqual([]);
		expect(writeGenerated(root, modules, { check: true, owned, format: upper })).toEqual([
			'a/a.gen.ts'
		]);
		writeFileSync(join(root, 'a/b.gen.ts'), '');
		writeFileSync(join(root, 'a/hand.ts'), '');
		expect(writeGenerated(root, modules, { check: true, owned })).toEqual(['a/b.gen.ts']);
		writeGenerated(root, modules, { check: false, owned });
		expect(existsSync(join(root, 'a/b.gen.ts'))).toBe(false);
		expect(existsSync(join(root, 'a/hand.ts'))).toBe(true);
		expect(readFileSync(join(root, 'a/a.gen.ts'), 'utf8')).toBe('export const a = 1\n');
		rmSync(join(root, 'a/a.gen.ts'));
		expect(writeGenerated(root, modules, { check: true, owned })).toEqual(['a/a.gen.ts']);
	});
});

describe('shortening', () => {
	test('one table for every source; a name not in it is an error', () => {
		const sources = [
			{
				file: 'a.ts',
				code: 'class A { numbers$ = 1; read() { return this.numbers$ } }'
			},
			{
				file: 'b.ts',
				code: 'export const b = (a: { flags$: number }) => a.flags$'
			}
		];
		const table = shortNames(sources);
		expect([...table]).toEqual([
			['flags$', '$0'],
			['numbers$', '$1']
		]);
		expect(shorten('b.js', 'const b = (a) => a.flags$', table)).toBe('const b = (a) => a.$0');
		expect(() => shorten('c.js', 'x.other$', table)).toThrow(
			'shorten: `other$` in c.js is not in the build'
		);
	});

	test('a shorthand property keeps its local: the key is shortened, the binding is not', () => {
		const table = shortNames([{ file: 'a.ts', code: 'o.box$' }]);
		expect(shorten('a.js', 'const { box$ } = o; use(box$); f({ box$ })', table)).toBe(
			'const { $0: box$ } = o; use(box$); f({ $0: box$ })'
		);
	});

	test('the most used names get the shortest', () => {
		const table = shortNames([{ file: 'a.ts', code: 'a.b$; a.z$; a.z$; a.z$; a.m$; a.m$' }]);
		expect([...table]).toEqual([
			['z$', '$0'],
			['m$', '$1'],
			['b$', '$2']
		]);
	});

	test('ties keep the order the names had with a `_` marker: a name before a longer one it begins only when the next letter is lower case', () => {
		const table = shortNames([{ file: 'a.ts', code: 'a.store$; a.storeOf$; a.sent$; a.sentry$' }]);
		expect([...table.keys()]).toEqual(['sent$', 'sentry$', 'storeOf$', 'store$']);
	});

	test('every short name is its own: one character for 64 names, then two', () => {
		const code = Array.from({ length: 5000 }, (_, i) => `a.n${i}$`).join(';');
		const names = [...shortNames([{ file: 'a.ts', code }]).values()];
		expect(new Set(names).size).toBe(5000);
		expect(names.filter((n) => n.length === 2)).toHaveLength(64);
		expect(names.filter((n) => n.length === 3)).toHaveLength(4096);
		for (const n of names) expect(n).toMatch(/^\$[\w$]+$/);
	});
});

describe('types', () => {
	test('declarations are generated from the macros’ signatures', () => {
		expect(
			declarations({
				header: ['The macros’ ambient types. Generated: do not edit.'],
				macros: [
					{ helpers: dts`type Point = { x: number; y: number }` },
					{
						types: dts`
              /** Twice a number. */
              function $twice(value: number): number
            `
					},
					{ types: 'function $one(): number' }
				]
			})
		).toMatchInlineSnapshot(`
      "// The macros’ ambient types. Generated: do not edit.

      export {}

      type Point = { x: number; y: number }

      declare global {
        /** Twice a number. */
        function $twice(value: number): number

        function $one(): number
      }
      "
    `);
	});

	test('a published declaration names no shortened member and no macro', () => {
		expect(
			publishedTypes(
				'dist/a.d.ts',
				dedent`
          export interface A {
            numbers$: number
            $hot: 1
          }
        `,
				{
					macros: ['$hot']
				}
			)
		).toEqual([
			'dist/a.d.ts:2: `numbers$` is shortened in the build: no published type names it.',
			'dist/a.d.ts:3: `$hot` is a macro: it exists only at build time.'
		]);
		expect(publishedTypes('dist/b.d.ts', 'export declare const b: number')).toEqual([]);
	});

	test('a template literal type is not a shortened name, and a member beside it still is', () => {
		expect(
			publishedTypes(
				'dist/c.d.ts',
				dedent`
          export type On<K extends string> = \`on\${K}\`
          export interface C {
            run$: \`\${string}x\`
          }
        `
			)
		).toEqual(['dist/c.d.ts:3: `run$` is shortened in the build: no published type names it.']);
	});
});

describe('the plugin', () => {
	test('never compiles Svelte: a component or a rune module, even when a skip lets it through', () => {
		const compile = (code: string) => ({ code: code.replace('$twice', 'twice'), map: null });
		const plugin = macroPlugin({ name: 'twice', compile });
		const open = macroPlugin({ name: 'twice', compile, skip: () => false });
		for (const p of [plugin, open])
			for (const file of ['/a.svelte', '/a.svelte.ts', '/a.svelte.js', '/a.svelte.ts?x=1'])
				expect(p.transform.handler('$twice(1)', file)).toBeNull();
		expect(open.transform.handler('$twice(1)', '/a.ts')!.code).toBe('twice(1)');
		expect(notSource('/a.svelte.ts')).toBe(true);
		expect(notSource('/a.ts')).toBe(false);
	});

	test('compiles sources, skips the rest, and emits what the compiles gathered', () => {
		const seen: Array<string> = [];
		const plugin = macroPlugin({
			name: 'twice',
			compile: (code, file) =>
				code.includes('$twice')
					? {
							code: code.replace('$twice', 'twice'),
							map: null,
							warnings: [`${file}: w`]
						}
					: null,
			took: (out) => void seen.push(out.code),
			bundle: (emit) => emit('seen.json', JSON.stringify(seen))
		});
		plugin.buildStart();
		expect(plugin.transform.handler('$twice(1)', '/a.css')).toBeNull();
		expect(plugin.transform.handler('$twice(1)', '/a.d.ts')).toBeNull();
		expect(plugin.transform.handler('const a = 1', '/a.ts')).toBeNull();
		expect(plugin.transform.handler('$twice(1)', '/a.ts?x')!.code).toBe('twice(1)');
		const files: Array<{ fileName: string; source: string }> = [];
		const warned: Array<string> = [];
		plugin.generateBundle.call({
			emitFile: (f) => void files.push(f),
			warn: (w) => void warned.push(w)
		});
		expect(warned).toEqual(['/a.ts: w']);
		expect(files).toEqual([{ type: 'asset', fileName: 'seen.json', source: '["twice(1)"]' }]);
	});
});

describe('published types, read as code', () => {
	test('a name in a comment is prose, not a type', () => {
		expect(
			publishedTypes(
				'dist/c.d.ts',
				dedent`
          /** \`$hot\` and \`numbers_\` */
          // numbers_
          export declare const c: 1
        `,
				{
					macros: ['$hot']
				}
			)
		).toEqual([]);
	});
});
