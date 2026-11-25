import { library } from '@ogygia/config/tsdown';
import { package_macros } from 'ogygia-internal-macros/plugin';

export default library({
	plugins: [package_macros(new URL('.', import.meta.url))],
	// the dock's drag/resize and its props decoder: installed with the package, resolved by the app;
	// `pg`: the Postgres store's driver, the app's own (loaded only when that store is used)
	external: [/^@neodrag\/svelte(\/|$)/, 'devalue', 'pg']
});
