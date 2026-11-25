// The hydration grid's server leg, loaded by the browser project's `region_grid_ssr` command
// (vitest.config.ts) through that project's own Vite server, so the server HTML is compiled with
// the same Svelte options as the client that hydrates it.
import './_region-grid-devtools.ts';
import { cases_of, spec_case, spec_props, type Place, type Spec } from './_region-grid.ts';
import { server_out } from './_region-grid-server.ts';
import { HAS, set_server_word } from './_stubs/server.runtime-flags.ts';

/** What the server renders for each case of `kind` at `place`, by case name: `{ head, body }` and
 *  what it said; built with the feature word `word` when one is given (every feature else). */
export function ssr_cell(
	kind: string,
	place: Place,
	word?: number
): Array<{ name: string; head: string; body: string; thrown: string | null; said: string }> {
	const env = import.meta.env as Record<string, unknown>;
	const dev = env.DEV;
	const all = HAS;
	env.DEV = place.env === 'dev';
	if (word !== undefined) set_server_word(word);
	try {
		return cases_of(kind, 'client').map((c) => {
			const out = server_out(c, place);
			return {
				name: c.name,
				head: out.head,
				body: out.body,
				thrown: out.thrown,
				said: out.parts.said
			};
		});
	} finally {
		env.DEV = dev;
		set_server_word(all);
	}
}

/** What the server renders for each fuzzed input at its place (the hydration fuzz's server leg). */
export function ssr_specs(
	inputs: Array<{ spec: Spec; place: Place }>
): Array<{ head: string; body: string; thrown: string | null }> {
	const env = import.meta.env as Record<string, unknown>;
	const dev = env.DEV;
	try {
		return inputs.map(({ spec, place }) => {
			env.DEV = place.env === 'dev';
			const out = server_out(spec_case(spec), place, () => [spec_props(spec)]);
			return { head: out.head, body: out.body, thrown: out.thrown };
		});
	} finally {
		env.DEV = dev;
	}
}
