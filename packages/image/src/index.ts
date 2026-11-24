/**
 * `@ogygia/image`: the browser-safe half. `<Img>` renders a source descriptor; the plugin
 * (`@ogygia/image/vite`) makes descriptors from files at build, and its server half makes each file a
 * page asks for.
 *
 * @packageDocumentation
 */
export { default as Img } from './Img.svelte';
export {
	image,
	isImage,
	type ImageDescriptor,
	type ImageField,
	type ImageFormat,
	type ImageOps
} from './descriptor.ts';
export type { ImageLayout, ImagePosition, ImagePreset, OutputFormat } from './config.ts';
export type { Laid, LaidSource, LayoutRequest } from './layout.ts';
export { layOut, type LayOutRequest } from './render.ts';
