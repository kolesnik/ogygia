// The runtime boot as a test bundles it with rolldown: core's boot, with `ogygia:boot/feature-code`
// holding the named boot features (as a build whose marks select them) and `null` for the rest. The
// other build words stay unresolved, so nothing folds on them.
import type { Plugin } from 'rolldown';

const ID = '\0feature-code';
const ALL: Readonly<Record<string, string>> = {
	wire_classes: 'wire-classes.ts',
	frames: 'frames.ts',
	lakes: 'lakes.ts',
	morph: 'morph.ts',
	interaction: 'interaction.ts',
	forms: 'form-continuity.ts',
	mpa_nav: 'nav-handle.ts',
	router: 'router.ts'
};

/** The boot's feature modules for `features` (their names as feature-code exports them). */
export function feature_code(src: string, features: readonly string[]): Plugin {
	return {
		name: 'test-feature-code',
		resolveId: (id) => (id === 'ogygia:boot/feature-code' ? ID : null),
		load: (id) =>
			id === ID
				? Object.entries(ALL)
						.map(([name, file]) =>
							features.includes(name)
								? `export * as ${name} from ${JSON.stringify(`${src}runtime/${file}`)};`
								: `export const ${name} = null;`
						)
						.join('\n')
				: null
	};
}
