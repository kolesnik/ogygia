import { expect, test } from 'vitest';
import * as rt from '../src/run.ts';
import { STAGE_COMPILED } from '../src/stage.ts';

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

test('the stage machine a production build carries is define’s reading of its steps', () => {
	const made = rt.compiled(...STAGE_COMPILED);
	expect([made.name, made.keys.length, made.initial, [...made.masks]]).toEqual([
		read.name,
		read.names!.length,
		read.initial,
		[...read.masks]
	]);
	expect(made.names).toBe(null);
});

test.runIf(typeof document === 'undefined')(
	'each state the stage names in a production build is the int define gives it',
	async () => {
		const { readFileSync } = await import('node:fs');
		const source = readFileSync(new URL('../src/stage.ts', import.meta.url), 'utf8');
		const sites = [...source.matchAll(/\(RULES \? '(\w+)' : (\d+)\)/g)].map((m) => [m[1], +m[2]!]);
		expect(sites.map(([name]) => name)).toEqual([...read.names!]);
		for (const [name, k] of sites) expect(read.ids[name as string]).toBe(k);
		expect(source).not.toMatch(/\.(?:go|move)\('|kind [!=]== '/);
	}
);

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
			expect(code).toContain('machine_stage_step_failed');
			expect(code).not.toContain('building');
			expect(code).not.toContain('a timer holds no more');
		} finally {
			rmSync(dir, { recursive: true, force: true });
		}
	}
);
