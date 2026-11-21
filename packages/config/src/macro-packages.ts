import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGES = fileURLToPath(new URL('../../', import.meta.url));

const RUNS_MACROS_RE = /\bpackage_macros\(/;

/**
 * The packages whose build runs ogygia's macros over their own `src` (their tsdown config calls
 * `package_macros`, internal/macros), as absolute folders. A test or a bench that reads one's source
 * by path reads it as that build compiles it (./vitest.ts `pluginTests`, Heisenbench's mirror): the
 * build is the one list, so a package that starts running the macros is read so everywhere.
 */
export function macro_packages(): string[] {
	const out: string[] = [];
	for (const name of readdirSync(PACKAGES)) {
		const config = join(PACKAGES, name, 'tsdown.config.ts');
		if (existsSync(config) && RUNS_MACROS_RE.test(readFileSync(config, 'utf8')))
			out.push(join(PACKAGES, name));
	}
	return out;
}
