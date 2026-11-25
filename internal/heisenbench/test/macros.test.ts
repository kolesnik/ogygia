import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { macro_packages } from '../../../packages/config/src/macro-packages.ts';
import { mirrored } from '../src/macros.ts';
import { unmirror } from '../src/unmirror.ts';

const CORE_SRC = fileURLToPath(new URL('../../../packages/core/src/', import.meta.url));
const CONTENT_SRC = fileURLToPath(new URL('../../../packages/content/src/', import.meta.url));

test("a plugin package's file compiles in the mirror as its own build compiles it: with no core types", () => {
	const file = `${CONTENT_SRC}collection-base.ts`;
	const out = mirrored(file);
	const code = readFileSync(out ?? file, 'utf8');
	assert.ok(
		code.includes("this.#life.now.kind === 'disposed'"),
		"content's build reads no types: its machines' call sites keep their names"
	);
});

test('every file of a package that runs the macros compiles in the mirror', () => {
	for (const dir of macro_packages()) {
		const src = join(dir, 'src');
		for (const name of readdirSync(src, { recursive: true }) as string[]) {
			if (!name.endsWith('.ts') || name.endsWith('.d.ts') || name.endsWith('.svelte.ts')) continue;
			assert.doesNotThrow(() => mirrored(join(src, name)), `${src}/${name}`);
		}
	}
});

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
