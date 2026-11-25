/**
 * What each encoder can make: one table over (encoder × need), so every row is listed and a test
 * snapshots it. The plugin reads it at build and hands each namer the needs its encoder cannot meet
 * (../namers/resolve.ts); the table itself never ships.
 *
 * Cloudflare's rows are its Image Transformations options (`/cdn-cgi/image/<options>/…`), which its
 * Images binding takes as `transform()` fields: the same set for both.
 *
 * @packageDocumentation
 */
import { decisions, type Decisions } from '@ogygia/machine';
import { NEEDS, type Need } from './needs.ts';

/** An encoder the table knows. */
export const ENCODER_NAMES = ['sharp', 'cloudflare'] as const;

/** One row's answer: can it, and as what (the option it maps to, or why not). */
export interface Capability {
	can: boolean;
	as: string;
}

const SHARP_AS: Readonly<Record<Need, string>> = {
	box: "resize fit 'cover'",
	'position center': "position 'centre'",
	'position top': "position 'top'",
	'position bottom': "position 'bottom'",
	'position left': "position 'left'",
	'position right': "position 'right'",
	'position attention': 'strategy.attention',
	'position entropy': 'strategy.entropy',
	'rotate quarter': 'rotate()',
	'rotate other': 'rotate()',
	flip: 'flip()',
	flop: 'flop()',
	grayscale: 'grayscale()',
	blur: 'blur(sigma)',
	sharpen: 'sharpen()',
	normalize: 'normalize()',
	negate: 'negate()',
	gamma: 'gamma()',
	tint: 'tint()',
	'modulate brightness': 'modulate({ brightness })',
	'modulate saturation': 'modulate({ saturation })',
	'modulate hue': 'modulate({ hue })',
	'modulate lightness': 'modulate({ lightness })',
	'format avif': 'avif()',
	'format webp': 'webp()',
	'format png': 'png()',
	'format jpeg': 'jpeg({ mozjpeg })'
};

const CLOUDFLARE: Readonly<Record<Need, Capability>> = {
	box: { can: true, as: 'fit=cover' },
	'position center': { can: true, as: 'no gravity (the center is the default)' },
	'position top': { can: true, as: 'gravity=top' },
	'position bottom': { can: true, as: 'gravity=bottom' },
	'position left': { can: true, as: 'gravity=left' },
	'position right': { can: true, as: 'gravity=right' },
	'position attention': { can: true, as: 'gravity=auto (saliency)' },
	'position entropy': { can: false, as: 'no gravity keeps the busiest part' },
	'rotate quarter': { can: true, as: 'rotate=90|180|270' },
	'rotate other': { can: false, as: 'rotate takes 90, 180 or 270 only' },
	flip: { can: true, as: 'flip=v' },
	flop: { can: true, as: 'flip=h' },
	grayscale: { can: true, as: 'saturation=0' },
	blur: { can: true, as: 'blur=<radius 1–250> (twice the sigma)' },
	sharpen: { can: true, as: 'sharpen=1' },
	normalize: { can: false, as: 'no option stretches the levels' },
	negate: { can: false, as: 'no option inverts the colors' },
	gamma: {
		can: false,
		as: "gamma is an exposure curve there, not sharp's gamma-correct resize"
	},
	tint: { can: false, as: 'no option tints' },
	'modulate brightness': { can: true, as: 'brightness=<multiplier>' },
	'modulate saturation': { can: true, as: 'saturation=<multiplier>' },
	'modulate hue': { can: false, as: 'no option turns the hue' },
	'modulate lightness': { can: false, as: 'no option adds lightness' },
	'format avif': { can: true, as: 'format=avif (WebP or JPEG past 1200 px a side)' },
	'format webp': { can: true, as: 'format=webp' },
	'format png': { can: true, as: 'format=png' },
	'format jpeg': { can: true, as: 'format=jpeg' }
};

/** What an encoder can make, need by need. */
export const CAPABILITIES: Decisions<
	{ encoder: (typeof ENCODER_NAMES)[number]; need: Need },
	Capability
> = decisions({
	name: 'image encoder capabilities',
	inputs: { encoder: ENCODER_NAMES, need: NEEDS },
	decide: (i): Capability =>
		i.encoder === 'sharp' ? { can: true, as: SHARP_AS[i.need] } : CLOUDFLARE[i.need]
});

/** The needs `encoder` cannot meet. */
export function cannot(encoder: (typeof ENCODER_NAMES)[number]): Need[] {
	return NEEDS.filter((need) => !CAPABILITIES.decide({ encoder, need }).can);
}
