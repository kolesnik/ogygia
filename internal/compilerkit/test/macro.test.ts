/**
 * A small compiler built on the kit, end to end: one macro (`$twice(x)` → `(x) * 2`, its argument
 * kept with its own edits; `$one()` → the runtime's `$.one()`), walked over one parse, its output
 * parsed again and its statements counted.
 */
import { describe, expect, test } from 'vitest';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import {
	Emitter,
	MacroError,
	Report,
	code,
	defineMacro,
	isCall,
	namesOf,
	parse,
	runtimeOf,
	vocabulary,
	walkPasses,
	type Mode
} from '../src/index.ts';
import { check, output } from '../src/testing.ts';

type Unit = { readonly emitter: Emitter; readonly report: Report };

const twice = defineMacro({
	names: ['$twice'],
	types: 'function $twice(value: number): number',
	pass: (unit: Unit) => ({
		call(node, v) {
			if (!isCall(node, '$twice')) return false;
			if (node.arguments.length !== 1) unit.report.fail(node, '$twice(value) takes one.');
			unit.emitter.rewrite(node, code`(${node.arguments[0]}) * 2`);
			v.next();
			return true;
		}
	})
});

const one = defineMacro({
	names: ['$one'],
	types: 'function $one(): number',
	pass: (unit: Unit) => ({
		call(node) {
			if (!isCall(node, '$one')) return false;
			unit.emitter.replace(node, `${unit.emitter.name('one')}()`);
			return true;
		}
	})
});

const MACROS = [twice, one];
const words = vocabulary(namesOf(MACROS));

function compile(source: string, mode: Mode = 'dev') {
	if (!words.mayUse(source)) return null;
	const report = new Report(source, 'x.ts');
	const program = parse(source, report);
	if (words.usedIn(program).size === 0) return null;
	const emitter = new Emitter(source, report, new Set());
	const unit = { emitter, report };
	walkPasses(
		program,
		null,
		MACROS.map((m) => m.pass(unit)),
		() => null
	);
	return {
		code: emitter.finish(
			runtimeOf({ mode, runtime: 'kit/runtime', reference: 'kit/reference' }),
			program
		)
	};
}

describe('a compiler on the kit', () => {
	test('a template keeps the nodes it names, with their own edits', () => {
		expect(output(compile, 'const a = $twice($twice(1) + $one())\n')).toBe(
			`${dedent`
        import * as $ from 'kit/runtime'
        const a = ((1) * 2 + $.one()) * 2
      `}\n`
		);
	});

	test('reference mode imports the reference', () => {
		expect(compile('const a = $one()\n', 'reference')!.code).toContain("from 'kit/reference'");
	});

	test('a file with no macro is not compiled, and a name in a string is none', () => {
		expect(output(compile, 'const a = 1\n')).toBe('(nothing to compile)');
		expect(output(compile, "const a = '$twice'\n")).toBe('(nothing to compile)');
	});

	test('a refusal names the file, line and column', () => {
		const said = check(() =>
			compile(
				`${dedent`
        const a = 1
        const b = $twice()
      `}\n`
			)
		).fails('x.ts:2:11  $twice(value) takes one.');
		expect(said).toMatch(/^x\.ts:2:11/);
		expect(() => compile('const a = $twice(\n')).toThrow(MacroError);
	});

	test('the runtime namespace steps aside for a file that binds `$`', () => {
		expect(
			compile(
				`${dedent`
        const $ = 1
        const a = $one()
      `}\n`
			)
		).not.toBeNull();
		const report = new Report('', 'x.ts');
		const e = new Emitter('', report, new Set(['$']));
		expect(e.name('one')).toBe('$1.one');
	});

	test('a macro owns $ names only', () => {
		expect(() => defineMacro({ names: ['twice'], pass: () => ({}) })).toThrow(
			'defineMacro: "twice" is not a $ name.'
		);
	});

	test('a reserved name is refused', () => {
		expect(() => vocabulary(['$state'], ['$state'], "Svelte's rune")).toThrow(
			"$state: Svelte's rune, so never a macro name."
		);
	});

	test('a check that wanted a failure says when there was none, or another', () => {
		expect(() => check(() => 1).fails('x')).toThrow('the compile did not fail');
		expect(() =>
			check(() => {
				throw new Error('y');
			}).fails('x')
		).toThrow('the compile failed otherwise');
		expect(check(() => 2).passes()).toBe(2);
	});
});
