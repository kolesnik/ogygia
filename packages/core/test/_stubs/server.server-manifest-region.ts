// One region module of the server-manifest stub's table (server.server-manifest-table.ts): imported per
// region id, it loads the module the bench or suite gave for that id.
import { given } from './server.server-manifest-table.ts';

const id = new URL(import.meta.url).searchParams.get('id') ?? '';

export function load(): Promise<{ default: unknown }> {
	const loader = given.get(id);
	if (!loader) throw new Error(`no server region ${id} in the stub's table`);
	return loader();
}
