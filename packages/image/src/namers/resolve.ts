/**
 * The namer of an app whose encoders are not all `sharp()`: for each recipe, the first encoder whose
 * links can make it names it (its link), else the endpoint makes it when its maker can (null: the
 * server signs the endpoint's URL), else the render fails `image_encoder_cannot`, naming the encoder
 * and the need. The plugin writes the plan at build from the capability table
 * (../encoders/capabilities.ts), so the table never ships. A link may also be bound by the encoder's
 * own limits (Vercel's sizes and qualities). In dev no CDN runs: every file is the endpoint's
 * (sharp), and the same check fails where production would.
 *
 * @packageDocumentation
 */
import { cloudflare_link } from '../encoders/cloudflare.ts';
import { needs_of, type Need } from '../encoders/needs.ts';
import { vercel_link, vercel_unmet, type VercelLimits } from '../encoders/vercel.ts';
import type { Namer, Recipe } from '../recipe.ts';
import { RenderError } from '../render-messages.ts';

/** One encoder that names its own links: whose, the needs they cannot meet, and its limits. */
export type LinkPlan =
	| { kind: 'cloudflare'; cannot: readonly Need[] }
	| ({ kind: 'vercel'; cannot: readonly Need[] } & VercelLimits);

/** What a namer resolves by, written by the plugin. */
export interface NamerPlan {
	/** The encoders listed, as `image({ encoder })` names them (`cloudflare()`). */
	encoders: string;
	/** Each encoder that names its own links, in order. */
	links: readonly LinkPlan[];
	/** The needs the endpoint's maker cannot meet, or null: no maker in this runtime. */
	endpoint: readonly Need[] | null;
	/** The dev server: a recipe links could name is the endpoint's. */
	dev: boolean;
}

function unmet(needs: readonly Need[], cannot: readonly Need[]): Need | undefined {
	return needs.find((n) => cannot.includes(n));
}

function link_unmet(link: LinkPlan, needs: readonly Need[], recipe: Recipe): string | undefined {
	const need = unmet(needs, link.cannot);
	if (need !== undefined || link.kind !== 'vercel') return need;
	return vercel_unmet(recipe, link);
}

function link_of(link: LinkPlan, recipe: Recipe): string {
	return link.kind === 'vercel' ? vercel_link(recipe, link)! : cloudflare_link(recipe);
}

/** The namer of `plan`. */
export function namer(plan: NamerPlan): Namer {
	return (recipe) => {
		const needs = needs_of(recipe);
		let first: string | undefined;
		for (const link of plan.links) {
			const missing = link_unmet(link, needs, recipe);
			if (missing === undefined) return plan.dev ? null : link_of(link, recipe);
			first ??= missing;
		}
		if (plan.endpoint !== null && unmet(needs, plan.endpoint) === undefined) return null;
		throw new RenderError('image_encoder_cannot', {
			encoder: plan.encoders,
			need:
				(plan.endpoint === null ? first : unmet(needs, plan.endpoint)) ?? first ?? needs.join(', ')
		});
	};
}
