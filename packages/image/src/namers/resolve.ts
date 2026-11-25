/**
 * The namer of an app whose encoders are not all `sharp()`: for each recipe, the first encoder whose
 * links can make it names it (its link), else the endpoint makes it when its maker can (null: the
 * server signs the endpoint's URL), else the render fails `image_encoder_cannot`, naming the encoder
 * and the need. The plugin writes the plan at build from the capability table
 * (../encoders/capabilities.ts), so the table never ships. In dev no CDN runs: every file is the
 * endpoint's (sharp), and the same check fails where production would.
 *
 * @packageDocumentation
 */
import { cloudflare_link } from '../encoders/cloudflare.ts';
import { needs_of, type Need } from '../encoders/needs.ts';
import type { Namer, Recipe } from '../recipe.ts';
import { RenderError } from '../render-messages.ts';

/** What a namer resolves by, written by the plugin. */
export interface NamerPlan {
	/** The encoders listed, as `image({ encoder })` names them (`cloudflare()`). */
	encoders: string;
	/** Each encoder that names its own links, in order: whose links, and the needs they cannot
	 *  meet. */
	links: readonly { kind: 'cloudflare'; cannot: readonly Need[] }[];
	/** The needs the endpoint's maker cannot meet, or null: no maker in this runtime. */
	endpoint: readonly Need[] | null;
	/** The dev server: a recipe links could name is the endpoint's. */
	dev: boolean;
}

const LINKS: Readonly<Record<NamerPlan['links'][number]['kind'], (r: Recipe) => string>> = {
	cloudflare: cloudflare_link
};

function unmet(needs: readonly Need[], cannot: readonly Need[]): Need | undefined {
	return needs.find((n) => cannot.includes(n));
}

/** The namer of `plan`. */
export function namer(plan: NamerPlan): Namer {
	return (recipe) => {
		const needs = needs_of(recipe);
		for (const link of plan.links)
			if (unmet(needs, link.cannot) === undefined)
				return plan.dev ? null : LINKS[link.kind](recipe);
		if (plan.endpoint !== null && unmet(needs, plan.endpoint) === undefined) return null;
		throw new RenderError('image_encoder_cannot', {
			encoder: plan.encoders,
			need: unmet(needs, plan.endpoint ?? plan.links[0]?.cannot ?? []) ?? needs.join(', ')
		});
	};
}
