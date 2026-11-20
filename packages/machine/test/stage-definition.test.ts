import { expect, test } from 'vitest';
import * as rt from '../src/run.ts';
import { STAGE_COMPILED } from '../src/stage.ts';

test('the stage machine a production build carries is define’s reading of its steps', () => {
	const read = rt.define({
		name: 'stage',
		initial: 'building',
		steps: {
			building: ['built', 'discarded'],
			built: ['committing', 'discarded'],
			committing: ['committed', 'discarded'],
			committed: [],
			discarded: []
		}
	});
	const made = rt.compiled(...STAGE_COMPILED);
	expect([made.name, [...made.names], made.initial, [...made.masks]]).toEqual([
		read.name,
		[...read.names],
		read.initial,
		[...read.masks]
	]);
});

test.runIf(typeof document === 'undefined')(
	'a production bundle of stage carries no define, though stage loads in a chunk of its own',
	async () => {
		const { rolldown } = await import('rolldown');
		const { mkdtempSync, rmSync, writeFileSync } = await import('node:fs');
		const { join } = await import('node:path');
		const { fileURLToPath } = await import('node:url');
		const here = fileURLToPath(new URL('.', import.meta.url));
		const dir = mkdtempSync(join(here, '.fold-'));
		try {
			const src = (f: string) =>
				JSON.stringify(fileURLToPath(new URL(`../src/${f}`, import.meta.url)));
			const entry = join(dir, 'entry.ts');
			// (the runtime in the boot, stage in a lazy chunk: as an app's router chunk takes it)
			writeFileSync(
				entry,
				// oxlint-disable-next-line ogygia/prefer-dedent -- the machine package has no dedent (core's is out of its reach)
				`import { create, Run } from ${src('run.ts')};\nexport const r = Run;\nexport const c = create;\nexport const later = () => import(${src('stage.ts')});\n`
			);
			const build = await rolldown({
				input: entry,
				resolve: { conditionNames: ['production', 'import', 'default'] },
				transform: { define: { 'import.meta.env.DEV': 'false', __OGYGIA_RULES__: 'false' } },
				logLevel: 'silent'
			});
			const { output } = await build.generate({ format: 'esm', minify: true });
			const code = output.map((o) => ('code' in o ? o.code : '')).join('\n');
			expect(code).toContain('building');
			expect(code).not.toContain('a timer holds no more');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
);
