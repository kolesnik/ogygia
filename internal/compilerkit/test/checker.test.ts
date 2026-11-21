/**
 * Types at build: one Program per project, made on first need, made again (incrementally) only
 * when a file is compiled from text other than what it read; a compile's node found by its span.
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, test } from 'vitest';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import { TypedProgram, nodeAt, ts } from '../src/checker.ts';

const A_CODE = dedent`
	export const n: number = 1;
`;
const B_CODE = dedent`
	import { n } from './a';
	export const m = n;
`;

const dir = mkdtempSync(join(fileURLToPath(new URL('.', import.meta.url)), '.checker-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
writeFileSync(
	join(dir, 'tsconfig.json'),
	JSON.stringify({ compilerOptions: { strict: true, noEmit: true, types: [] }, include: ['*.ts'] })
);
const A = join(dir, 'a.ts');
const B = join(dir, 'b.ts');
writeFileSync(A, A_CODE);
writeFileSync(B, B_CODE);

/** The type of the name `const <name>` declares in `file`, read as `code`. */
const type_of = (p: TypedProgram, file: string, code: string, name: string): string => {
	const at = p.at(file, code)!;
	const start = code.indexOf(`const ${name}`) + 6;
	const node = nodeAt(at.file, start, start + name.length)!;
	return at.checker.typeToString(at.checker.getTypeAtLocation(node));
};

describe('one Program per project', () => {
	test('made once, on first need, for every file the compiles ask about', () => {
		const p = new TypedProgram(join(dir, 'tsconfig.json'));
		expect(p.builds).toBe(0);
		expect(type_of(p, B, B_CODE, 'm')).toBe('number');
		expect(type_of(p, A, A_CODE, 'n')).toBe('number');
		expect(p.builds).toBe(1);
	});

	test('a file compiled from other text than it read: made again, and the others see it', () => {
		const p = new TypedProgram(join(dir, 'tsconfig.json'));
		const old = p.program;
		expect(type_of(p, A, `export const n: string = 'x';\n`, 'n')).toBe('string');
		expect(p.builds).toBe(2);
		expect(type_of(p, B, B_CODE, 'm')).toBe('string');
		expect(p.builds).toBe(2);
		expect(p.program.getSourceFile(B)).toBe(old.getSourceFile(B));
	});

	test('a file outside the project is none of its', () => {
		const p = new TypedProgram(join(dir, 'tsconfig.json'));
		expect(p.at(join(dir, 'c.ts'), '')).toBe(null);
	});

	test('a node by its span: the outermost one that spans it exactly', () => {
		const p = new TypedProgram(join(dir, 'tsconfig.json'));
		const code = B_CODE;
		const at = p.at(B, code)!;
		const start = code.indexOf('m = n');
		expect(nodeAt(at.file, start, start + 1)?.kind).toBe(ts.SyntaxKind.Identifier);
		expect(nodeAt(at.file, start, start + 2)).toBe(null);
	});
});
