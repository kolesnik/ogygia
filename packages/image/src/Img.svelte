<!--
@component
One image from a descriptor. Say how it sits on the page (`layout`, and at most a `width`); the
srcset, `sizes`, the width and height attributes, the blur placeholder and the loading hints follow.
Server HTML only: it ships no script.

```svelte
<Img of={hero} layout="fullWidth" priority alt="The harbor at dusk" />
<Img of={post.data.cover} width={400} alt={post.data.title} />
<Img of={avatar} layout="fixed" width={48} alt="" />
```
-->
<script lang="ts">
	import type { HTMLImgAttributes } from 'svelte/elements';
	import type { ImageDescriptor } from './descriptor.ts';
	import { lay_out, type ImageLayout } from './layout.ts';
	import { placeholder_style } from './placeholder.ts';

	type Props = Omit<HTMLImgAttributes, 'src' | 'srcset' | 'sizes' | 'width' | 'height' | 'alt'> & {
		/** The image: from `import.meta.og.image()`, a markdown or frontmatter image. */
		of: ImageDescriptor;
		/** What the image shows, for people who cannot see it. `""` for a decorative image. */
		alt: string;
		/** How the image sits on the page. Default `constrained`. */
		layout?: ImageLayout;
		/** Display width, CSS pixels. */
		width?: number;
		/** Display height, CSS pixels. With `width`, the image fills that box, cropped. */
		height?: number;
		/** Replaces the `sizes` the layout derives. */
		sizes?: string;
		/** The page's main image (its LCP): loads first, preloaded from the head. */
		priority?: boolean;
		/** Paint the blur placeholder until the image arrives. Default `true`. */
		placeholder?: boolean;
	};

	let {
		of,
		alt,
		layout = 'constrained',
		width,
		height,
		sizes,
		priority = false,
		placeholder = true,
		style,
		...rest
	}: Props = $props();

	const laid = $derived(lay_out(of, { layout, width, height, sizes }));
	const css = $derived(
		[
			placeholder ? placeholder_style(of.ph) : '',
			laid.cover ? `object-fit:cover;aspect-ratio:${laid.width}/${laid.height}` : '',
			typeof style === 'string' ? style : ''
		]
			.filter(Boolean)
			.join(';') || undefined
	);
</script>

<svelte:head>
	{#if priority}
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
		{...rest}
		src={laid.src}
		srcset={laid.srcset}
		sizes={laid.sizes}
		width={laid.width}
		height={laid.height}
		{alt}
		loading={priority ? 'eager' : 'lazy'}
		decoding={priority ? 'sync' : 'async'}
		fetchpriority={priority ? 'high' : undefined}
		data-og-img={layout}
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
