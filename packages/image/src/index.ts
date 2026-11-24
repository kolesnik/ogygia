/**
 * `@ogygia/image`: the browser-safe half. `<Img>` renders a descriptor; the plugin
 * (`@ogygia/image/vite`) makes descriptors from files at build.
 */
export { default as Img } from './Img.svelte';
export {
	isImage,
	type ImageDescriptor,
	type ImageFormat,
	type ImageVariant
} from './descriptor.ts';
export { lay_out as layOut, type ImageLayout, type Laid, type LayoutRequest } from './layout.ts';
