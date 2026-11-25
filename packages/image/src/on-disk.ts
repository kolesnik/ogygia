/**
 * The image server realm's Node half: what it reads and notes on disk in the dev server and in the
 * build, never on a live server. ../server.ts loads it only there, so a server bundle for another
 * runtime (Workers) never runs it.
 *
 * @packageDocumentation
 */
import fs from 'node:fs';
import path from 'node:path';

export { note_built, note_origin } from './store.ts';

/** Is there a file at `rel` (a `/` path) under `dir`? */
export function exists(dir: string, rel: string): boolean {
	return fs.existsSync(path.join(dir, ...rel.split('/')));
}
