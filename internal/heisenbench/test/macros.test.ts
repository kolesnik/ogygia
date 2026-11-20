import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { mirrored } from '../src/macros.ts';
import { unmirror } from '../src/unmirror.ts';

const CORE_SRC = fileURLToPath(new URL('../../../packages/core/src/', import.meta.url));

test('a core file with no macro loads as it is: no mirror', () => {
	assert.equal(mirrored(`${CORE_SRC}runtime/morph.ts`), null);
	assert.equal(mirrored(fileURLToPath(new URL('../src/preload.ts', import.meta.url))), null);
});

test("a report's ids name the source files, not their mirrors", () => {
	assert.equal(
		unmirror('{"id":".heisenbench/macros/prod/packages/core/src/runtime/a.ts > f"}'),
		'{"id":"packages/core/src/runtime/a.ts > f"}'
	);
	assert.equal(
		unmirror('/r/.heisenbench/macros/dev/packages/core/src/a.ts'),
		'/r/packages/core/src/a.ts'
	);
});
