<!--
@component
One image from a descriptor. Say how it sits on the page (a `preset` from `image({ presets })`, or
`layout` and at most a `width`, `aspect`); the files to ask for, the srcset, `sizes`, the width and
height attributes, the blur placeholder and the loading hints follow. Its own props say over the
preset's. Every file is a signed URL the image endpoint makes on first request. Server HTML only: it
ships no script, and no inline event handler. Besides its own props it passes `class`, `id`,
`style`, `title`, `crossorigin`, `referrerpolicy` and `draggable` to the `<img>`.

```svelte
<Img of={hero} preset="cover" alt="The harbor at dusk" />
<Img of={post.data.cover} preset="thumb" alt={post.data.title} />
<Img of={avatar} layout="fixed" width={48} alt="" />
```
-->
<script lang="ts">
	import type { HTMLImgAttributes } from 'svelte/elements';
	import type { ImageDescriptor } from './descriptor.ts';
	import type { ImageLayout, ImagePosition } from './config.ts';
	import { placeholder_style } from './placeholder.ts';
	import { layOut, preset_of } from './render.ts';

	type Props = Pick<
		HTMLImgAttributes,
		'class' | 'id' | 'style' | 'title' | 'crossorigin' | 'referrerpolicy' | 'draggable'
	> & {
		/** The image: from `import.meta.og.image()`, a markdown or frontmatter image. */
		of: ImageDescriptor;
		/** What the image shows, for people who cannot see it. `""` for a decorative image. */
		alt: string;
		/** A preset from `image({ presets })`: how this image is shown. Own props say over it. */
		preset?: string;
		/** How the image sits on the page. Default `constrained`. */
		layout?: ImageLayout;
		/** Display width, CSS pixels. */
		width?: number;
		/** Display height, CSS pixels. With `width`, the image is cropped to that box. */
		height?: number;
		/** The box's shape (`16 / 9`, `'1/1'`): the files are cropped to it. */
		aspect?: number | string;
		/** Where a crop keeps. Default `center`. */
		position?: ImagePosition;
		/** Replaces the `sizes` the layout derives. */
		sizes?: string;
		/** The page's main image (its LCP): loads first, preloaded from the head. */
		priority?: boolean;
		/** Paint the blur placeholder until the image arrives. Default `true`. */
		placeholder?: boolean;
		/** Glide into the same source on the next page in a client-side navigation (a view
		 *  transition named by the source). At most one per source on a page. */
		morph?: boolean;
	};

	let {
		of,
		alt,
		preset,
		layout,
		width,
		height,
		aspect,
		position,
		sizes,
		priority,
		placeholder,
		morph,
		class: klass,
		id,
		style,
		title,
		crossorigin,
		referrerpolicy,
		draggable
	}: Props = $props();

	const p = $derived(preset_of(preset));
	const shown = $derived(layout ?? p.layout ?? 'constrained');
	const first = $derived(priority ?? p.priority ?? false);
	const laid = $derived(
		layOut(of, { preset, layout: shown, width, height, aspect, position, sizes })
	);
	const css = $derived(
		[
			(placeholder ?? p.placeholder ?? true) ? placeholder_style(of.ph) : '',
			laid.cover ? `object-fit:cover;aspect-ratio:${laid.width}/${laid.height}` : '',
			(morph ?? p.morph) ? `view-transition-name:og-img-${of.id}` : '',
			typeof style === 'string' ? style : ''
		]
			.filter(Boolean)
			.join(';') || undefined
	);
</script>

<svelte:head>
	{#if first}
		<link
			rel="preload"
			as="image"
			href={laid.preload.href}
			imagesrcset={laid.preload.srcset}
			imagesizes={laid.preload.sizes}
			type={laid.preload.type}
			fetchpriority="high"
		/>
	{/if}
</svelte:head>

{#snippet img()}
	<img
		class={klass}
		{id}
		{title}
		{crossorigin}
		{referrerpolicy}
		{draggable}
		src={laid.src}
		srcset={laid.srcset}
		sizes={laid.sizes}
		width={laid.width}
		height={laid.height}
		{alt}
		loading={first ? 'eager' : 'lazy'}
		decoding={first ? 'sync' : 'async'}
		fetchpriority={first ? 'high' : undefined}
		data-og-img={shown}
		style={css}
	/>
{/snippet}

{#if laid.sources.length}
	<picture>
		{#each laid.sources as source (source.type)}
			<source type={source.type} srcset={source.srcset} sizes={laid.sizes} />
		{/each}
		{@render img()}
	</picture>
{:else}
	{@render img()}
{/if}

<style>
	:global(:where(img[data-og-img='constrained'])) {
		max-width: 100%;
		height: auto;
	}
	:global(:where(img[data-og-img='fullWidth'])) {
		width: 100%;
		height: auto;
	}
</style>
