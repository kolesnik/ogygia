<script lang="ts">
	// /bench-cms/kit with a hero image or a lead paragraph at the top (the page's LCP): the Kit-hydrated
	// twin of /lcp/[shape].
	import CmsShell from '$lib/bench/CmsShell.svelte';
	import LcpTop from '$lib/bench/LcpTop.svelte';
	import Lake from '$lib/bench/KitLake.svelte' with { wake: 'none' };
	import { X_WIDGET_SCRIPT } from '$lib/bench/x-widget';
	let { data } = $props();
	const widgets = Array.from({ length: 220 }, (_, i) => i);
</script>

<svelte:head>
	<title>bench: LCP {data.shape} (Kit-hydrated)</title>
	{@html X_WIDGET_SCRIPT}
</svelte:head>

<Lake tag="header" idle={2} load={1} />
<LcpTop shape={data.shape} />
<CmsShell page={data}>
	<div data-widgets>
		{#each widgets as i (i)}
			<x-widget><p>widget <strong>{i}</strong></p></x-widget>
		{/each}
	</div>
</CmsShell>
<Lake tag="footer" idle={2} load={1} visible={1} />
