/**
 * A plugin package's own build (`package_macros`, src/plugin.ts): its tsdown runs the macros over its
 * `src` alone, so a maker its browser half calls with options the build reads ships without its
 * runtime check (the boot carries no option prose for it), and nothing outside `src` is touched.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, test } from 'vitest';
import { rolldown } from 'rolldown';
import { dedent } from '../../../packages/core/src/contract/dedent.ts';
import { package_macros } from '../src/plugin.ts';

const SAY = `${dedent`
	import { say } from '@ogygia/machine';
	export const said = say();
`}\n`;

async function built(file: string, root: string): Promise<string> {
	const build = await rolldown({
		input: file,
		external: [/^@ogygia\//],
		plugins: [package_macros(pathToFileURL(`${root}/`))],
		logLevel: 'silent'
	});
	const { output } = await build.generate({ format: 'esm' });
	await build.close();
	return output[0].code;
}

describe('package_macros', () => {
	test('a maker in the package’s src is made unchecked; one outside src is left as written', async () => {
		const root = mkdtempSync(join(tmpdir(), 'og-pkg-macros-'));
		try {
			mkdirSync(join(root, 'src'));
			mkdirSync(join(root, 'scripts'));
			writeFileSync(join(root, 'src/a.ts'), SAY);
			writeFileSync(join(root, 'scripts/b.ts'), SAY);
			const inside = await built(join(root, 'src/a.ts'), root);
			expect(inside).toContain('trusted_say');
			expect(inside).toContain('@ogygia/machine/internal');
			const outside = await built(join(root, 'scripts/b.ts'), root);
			expect(outside).not.toContain('trusted_say');
			expect(outside).toMatch(/\bsay\(\)/);
		} finally {
			rmSync(root, { recursive: true, force: true });
		}
	});
});
