import { fileURLToPath } from 'node:url';
import { e2e_output } from '@ogygia/tooling/e2e/build.ts';

/** A path in the palaestra's e2e build, the one the suite's preview serves: `built('server')`. */
export const built = (...parts: string[]): string =>
	e2e_output(fileURLToPath(new URL('..', import.meta.url)), ...parts);
