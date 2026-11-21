import { library } from '@ogygia/config/tsdown';
import { package_macros } from 'ogygia-internal-macros/plugin';

export default library({
	plugins: [package_macros(new URL('.', import.meta.url))],
	// the content stack: installed with the plugin, resolved by the app at runtime
	external: [
		'mdsvex',
		'shiki',
		/^shiki\//,
		'@orama/orama',
		'bits-ui',
		'vite',
		/^@sveltejs\/vite-plugin-svelte/
	]
});
