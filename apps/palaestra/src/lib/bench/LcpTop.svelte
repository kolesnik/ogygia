<script lang="ts">
	// The LCP element of the /lcp pages: a hero image the page marks critical, or a lead paragraph
	// that covers more of the first screen than anything else on it.
	let { shape }: { shape: string } = $props();
	const LEAD =
		'A lead paragraph set large, the biggest thing on the first screen, so the largest contentful paint is text. ';
</script>

{#if shape === 'hero'}
	<img
		data-lcp
		src="/lcp-hero.png"
		fetchpriority="high"
		width="960"
		height="360"
		alt=""
		style="display:block;width:960px;height:360px"
	/>
{:else}
	<p data-lcp style="font-size:28px;line-height:1.3;max-width:1100px">{LEAD.repeat(6)}</p>
{/if}
