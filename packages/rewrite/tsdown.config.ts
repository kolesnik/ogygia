import { library } from '@ogygia/config/tsdown';
import { minifySync } from 'rolldown/utils';
import { package_macros } from 'ogygia-internal-macros/plugin';

// The restorer ships as its own source, inline in every page that restores something
// (src/pass.ts `RESTORER_SCRIPT`, `restore.toString()`): its built module is minified, so a page
// carries no comment or long name of it (test/restorer-size.test.ts).
export default library({
	plugins: [
		package_macros(new URL('.', import.meta.url)),
		{
			name: 'restorer-minified',
			generateBundle(_options, bundle) {
				const chunk = bundle['restore.js'];
				if (chunk?.type === 'chunk')
					chunk.code = minifySync(chunk.fileName, chunk.code, {
						compress: true,
						mangle: true
					}).code;
			}
		}
	]
});
