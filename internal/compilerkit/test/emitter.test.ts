/**
 * The emitter's imports: the runtime namespace, and named exports of other modules (a gate's
 * flag, a sentinel), each imported once per file under a name the file does not bind.
 */
import { describe, expect, test } from 'vitest';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import { Emitter, Report, parse } from '../src/index.ts';

function emitter(source: string, taken: ReadonlyArray<string> = []) {
	const report = new Report(source, 'x.ts');
	const program = parse(source, report);
	return { e: new Emitter(source, report, new Set(taken)), program };
}

describe('named imports', () => {
	test('a named export is imported once, however often it is read', () => {
		const { e, program } = emitter(
			`${dedent`
			f()
			g()
		`}\n`
		);
		const a = e.imported('esm-env', 'DEV');
		const b = e.imported('esm-env', 'DEV');
		expect([a, b]).toEqual(['DEV', 'DEV']);
		e.s.prepend(`${a} && `);
		expect(e.finish('kit/runtime', program)).toBe(
			`${dedent`
				import { DEV } from 'esm-env'
				DEV && f()
				g()
			`}\n`
		);
	});

	test('the names of one module share one import; each module gets its own, beside the runtime', () => {
		const { e, program } = emitter('f()\n');
		e.replace(
			program.body[0].expression,
			`${e.name('go')}(${e.imported('a', 'X')}, ${e.imported('b', 'Y')}, ${e.imported('a', 'Z')})`
		);
		expect(e.finish('kit/runtime', program)).toBe(
			`${dedent`
			import * as $ from 'kit/runtime'
			import { X, Z } from 'a'
			import { Y } from 'b'
			$.go(X, Y, Z)
		`}\n`
		);
	});

	test('a name the file binds is not shadowed: the import takes another', () => {
		const { e, program } = emitter(
			`${dedent`
			const DEV = 1
			f(DEV)
		`}\n`,
			['DEV']
		);
		const dev = e.imported('esm-env', 'DEV');
		expect(dev).toBe('DEV_1');
		e.s.appendLeft(program.body[1].start, `${dev} && `);
		expect(e.finish('kit/runtime', program)).toBe(
			`${dedent`
				import { DEV as DEV_1 } from 'esm-env'
				const DEV = 1
				DEV_1 && f(DEV)
			`}\n`
		);
	});
});
