/**
 * The macros' ambient declarations (`macros.d.ts`, beside this package): what TypeScript reads for
 * a `$` name in core's source. `node src/types.ts` writes it; a test holds it fresh.
 *
 * @packageDocumentation
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { declarations } from 'ogygia-internal-compilerkit';
import { MACROS } from './macros.ts';

/** Where the declarations live. */
export const DTS_FILE: string = fileURLToPath(new URL('../macros.d.ts', import.meta.url));

/** The declarations' text. */
export function macro_types(): string {
	return declarations({
		header: [
			"ogygia's build-time macros (internal/macros): written by `node internal/macros/src/types.ts`,",
			'held fresh by internal/macros/test/types.test.ts. Never hand-edited.'
		],
		macros: MACROS
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) writeFileSync(DTS_FILE, macro_types());
