/**
 * `$hot` and `$layout`: checks at build, compiled to the functions they mark; `$hot.allow` names an
 * allocation from the closed list.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import { check } from 'ogygia-internal-compilerkit/testing';
import { compile } from '../src/compile.ts';

const OPTIONS = { mode: 'dev', runtime: 'rt', reference: 'rt' } as const;
const lines = (...rows: ReadonlyArray<string>): string => rows.map((r) => `${r}\n`).join('');

/** Compiles `files` (name → text) in a temporary folder; the output of `name`. */
function compiled(files: Record<string, string>, name: string): string | null {
	const dir = mkdtempSync(join(tmpdir(), 'og-hot-'));
	try {
		for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
		return compile(files[name]!, name, { ...OPTIONS, path: join(dir, name) })?.code ?? null;
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}
const one = (...rows: ReadonlyArray<string>) => compiled({ 'a.ts': lines(...rows) }, 'a.ts');
const refused = (...rows: ReadonlyArray<string>) => check(() => one(...rows));

const SWAP = [
	'export const swap: (h: number[], i: number, j: number) => void = $hot(function swap(',
	'\th: number[],',
	'\ti: number,',
	'\tj: number',
	'): void {',
	'\tconst t = h[i];',
	'\th[i] = h[j];',
	'\th[j] = t;',
	'});'
];

describe('a $hot function', () => {
	test('that makes nothing compiles to itself', () => {
		const out = one(...SWAP)!;
		expect(out).toContain('export function swap(');
		expect(out).not.toContain('$hot');
	});

	test('that allocates fails at the allocation, naming it', () => {
		refused(
			'const f: (h: number[], i: number) => void = $hot(function f(h: number[], i: number): void {',
			'\t[h[i], h[0]] = [h[0], h[i]];',
			'});'
		).fails('a.ts:2:2  f is $hot: array destructuring (an iterator)');
		refused(
			'const f: () => object = $hot(function f(): object {',
			'\treturn { a: 1 };',
			'});'
		).fails('f is $hot: an object literal');
	});

	test('calls only $hot functions, pure globals and methods that make nothing', () => {
		expect(
			one(
				...SWAP,
				'const g: (h: number[]) => number = $hot(function g(h: number[]): number {',
				'\tswap(h, 0, 1);',
				'\treturn Math.max(h.indexOf(2), h.pop() ?? 0);',
				'});'
			)
		).not.toBeNull();
		refused('const g: () => void = $hot(function g(): void {', '\tother();', '});').fails(
			'g is $hot: a call into other, which is not $hot'
		);
		refused(
			'const g: (a: number[]) => void = $hot(function g(a: number[]): void {',
			'\ta.push(1);',
			'});'
		).fails('a call of .push(…), which may allocate');
	});

	test('a $hot function imported from another module may be called', () => {
		const files = {
			'b.ts': lines(...SWAP),
			'a.ts': lines(
				"import { swap } from './b.ts';",
				'const g: (h: number[]) => void = $hot(function g(h: number[]): void {',
				'\tswap(h, 0, 1);',
				'});'
			)
		};
		expect(compiled(files, 'a.ts')).toContain('function g(');
	});

	test('a named exception from the closed list is allowed, and compiles to its expression', () => {
		const out = one(
			'const g: (h: number[]) => void = $hot(function g(h: number[]): void {',
			"\t$hot.allow('grow', h.push(1));",
			'});'
		)!;
		expect(out).toContain('\th.push(1);');
		refused(
			'const g: (h: number[]) => void = $hot(function g(h: number[]): void {',
			"\t$hot.allow('because', h.push(1));",
			'});'
		).fails('$hot.allow names an exception from the closed list');
	});
});

describe('layout', () => {
	test('a $hot function that forces a layout, or calls a $layout one, fails', () => {
		refused(
			'const g: (e: Element) => number = $hot(function g(e: Element): number {',
			'\treturn e.getBoundingClientRect().top;',
			'});'
		).fails('.getBoundingClientRect(), which forces a layout');
		refused(
			'const g: (e: HTMLElement) => number = $hot(function g(e: HTMLElement): number {',
			'\treturn e.offsetWidth;',
			'});'
		).fails('a read of .offsetWidth, which forces a layout');
		refused(
			'const m: (e: Element) => number = $layout(function m(e: Element): number {',
			'\treturn e.getBoundingClientRect().top;',
			'});',
			'const g: (e: Element) => number = $hot(function g(e: Element): number {',
			'\treturn m(e);',
			'});'
		).fails('a call into m, which forces a layout ($layout)');
	});

	test('a $layout function compiles to itself', () => {
		expect(
			one(
				'export const m: (e: Element) => number = $layout(function m(e: Element): number {',
				'\treturn e.getBoundingClientRect().top;',
				'});'
			)
		).toContain('export function m(e: Element): number {');
	});
});

describe('refused', () => {
	test('a mark anywhere but a definition, an allow outside a $hot function', () => {
		refused('run($hot(function f(): void {}));').fails('$hot marks a function where it is defined');
		refused("const a = $hot.allow('grow', [1]);").fails(
			'$hot.allow marks an allocation inside a $hot function'
		);
	});
});
