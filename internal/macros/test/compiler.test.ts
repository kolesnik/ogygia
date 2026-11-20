/**
 * ogygia's macro compiler with no macro yet: every file passes through untouched, Svelte's files
 * are never read, and the gates write the conditions core's own code reads.
 */
import { describe, expect, test } from 'vitest';
import { Emitter, Report, gated, parse } from 'ogygia-internal-compilerkit';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import { compile } from '../src/compile.ts';
import { RESERVED, VOCABULARY } from '../src/compiler.ts';
import { MACRO_NAMES } from '../src/names.ts';
import { DEV, GATES, RULES } from '../src/gates.ts';
import { ogygia_macros, specifier } from '../src/plugin.ts';

const OPTIONS = { mode: 'dev', runtime: 'rt', reference: 'ref' } as const;

describe('a file with no macro', () => {
	test('is not compiled, whatever $ names it reads', () => {
		expect(compile('const a = $x + $state', 'a.ts', OPTIONS)).toBeNull();
		expect(compile('const a = 1', 'a.ts', OPTIONS)).toBeNull();
	});

	test("the vocabulary takes none of Svelte's runes", () => {
		expect(VOCABULARY.filter((n) => RESERVED.includes(n))).toEqual([]);
	});
});

describe('the plugin', () => {
	const ROOT = '/repo/packages/core/src/';
	const plugin = ogygia_macros({ runtime: '/repo/rt.ts', roots: [ROOT] });

	test('never reads a Svelte file, nor one outside its roots', () => {
		for (const file of [`${ROOT}a.svelte`, `${ROOT}a.svelte.ts`, '/repo/other/a.ts'])
			expect(plugin.transform.handler('const a = 1', file)).toBeNull();
	});

	test('a runtime file is imported relatively', () => {
		expect(specifier('/repo/packages/core/src/runtime/a.ts', '/repo/rt.ts')).toBe(
			'../../../../rt.ts'
		);
		expect(specifier('/repo/a.ts', '/repo/rt.ts')).toBe('./rt.ts');
		expect(specifier('/repo/a.ts', 'pkg/rt')).toBe('pkg/rt');
	});
});

describe('the gates', () => {
	const behind = (gate: typeof DEV) => {
		const source = `${dedent`
			check(1)
			check(2)
		`}\n`;
		const report = new Report(source, 'x.ts');
		const program = parse(source, report);
		const e = new Emitter(source, report, new Set());
		for (const s of program.body) gated(e, s.expression, gate);
		return e.finish('rt', program);
	};

	test("dev reads import.meta.env.DEV, as core's own checks do", () => {
		expect(behind(DEV)).toBe(
			`${dedent`
			import.meta.env.DEV && check(1)
			import.meta.env.DEV && check(2)
		`}\n`
		);
	});

	test('rules is development or a rules build, one constant per file', () => {
		expect(behind(RULES)).toBe(
			`${dedent`
			const RULES = import.meta.env?.DEV || (typeof __OGYGIA_RULES__ !== 'undefined' ? __OGYGIA_RULES__ : false);
			RULES && check(1)
			RULES && check(2)
		`}\n`
		);
	});

	test('each by its name', () => {
		expect([...GATES.keys()]).toEqual(['dev', 'rules']);
	});
});

describe('the reserved names', () => {
	test('every macro name is reserved, so the Svelte lint refuses it', () => {
		expect(VOCABULARY.filter((n) => !MACRO_NAMES.includes(n))).toEqual([]);
	});
});
