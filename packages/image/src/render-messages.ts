/**
 * The messages `<Img>` itself can say, kept apart from the plugin's (./messages.ts) so a page that
 * renders an image in an island ships these few and not the build's.
 *
 * @packageDocumentation
 */
import { define_messages, prose, type MessagesOf } from '@ogygia/core/internal/messages';

/** The errors `<Img>` throws at render. */
export const IMAGE_RENDER_ERRORS = {
	image_preset_unknown: {
		text: (a: { preset: string; known: string }): string =>
			`<Img preset="${a.preset}">: no such preset. image({ presets }) names: ${a.known}.`,
		details: (): string => prose`
			A preset is a name for how an image is shown (\`thumb\`, \`cover\`), declared once in
			vite.config: \`image({ presets: { thumb: { width: 400, aspect: '1/1' } } })\`. A name the
			config does not declare would render the image some other way, so the render stops.
		`
	},
	image_prop_invalid: {
		text: (a: { prop: string; value: string; want: string }): string =>
			`<Img ${a.prop}={${a.value}}>: ${a.prop} must be ${a.want}.`,
		details: (): string => prose`
			Every file an \`<Img>\` (or \`layOut()\`) asks for is named by its size and quality, and the
			image endpoint makes only whole sizes above 0 and a whole quality from 1 to 100. A fraction
			of a pixel is rounded (\`width={1000 / 3}\` shows 333 pixels wide), but a size of 0 or less,
			one that is not a number, an aspect that does not read as a ratio, a box taller than the
			source can fill (more times as tall as wide than the source has pixels of height), a file
			past 99999 pixels a side, a \`position\` that is not one of the crop positions, or a
			quality out of range would name files no server makes, so the render stops.
		`
	},
	image_no_server: {
		text: (): string => prose`
			<Img> rendered on the server, but the image plugin's server half is not running, so no file
			URL can be signed.
		`,
		details: (): string => prose`
			Every file an \`<Img>\` asks for is a URL the server signs and the image endpoint makes. Both
			live in \`@ogygia/image\`'s server half, which ogygia's handle starts: list \`image()\` in
			vite.config's plugins and export ogygia's \`handle\` from hooks.server.ts.
		`
	}
};

type Own = MessagesOf<typeof IMAGE_RENDER_ERRORS, Record<string, never>>;
const own: Own = define_messages(IMAGE_RENDER_ERRORS, {});
/** `throw new RenderError(code, args)`. */
export const RenderError: Own['OgygiaError'] = own.OgygiaError;
