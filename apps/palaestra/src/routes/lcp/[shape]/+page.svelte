<script lang="ts">
	// The /bench-cms islands under a hero image or a lead paragraph (the page's LCP): see +page.server.ts.
	import BlockLoad from '$lib/bench/BenchBlock.svelte' with { wake: 'load' };
	import BlockVisible from '$lib/bench/BenchBlock.svelte' with { wake: 'visible' };
	import BenchHeader from '$lib/bench/BenchHeader.svelte' with { wake: 'load' };
	import BenchPageReader from '$lib/bench/BenchPageReader.svelte' with { wake: 'load' };
	import LcpTop from '$lib/bench/LcpTop.svelte';
	import { header_config } from '$lib/bench/data';
	let { data } = $props();
</script>

<svelte:head><title>bench: LCP {data.shape} (islands)</title></svelte:head>

<BenchHeader config={header_config} />
<LcpTop shape={data.shape} />
<h1 data-static-shell>{data.catalog.title}</h1>
<BenchPageReader />

{#each data.catalog.blocks as block, i (block.id)}
	{#if i % 2 === 0}
		<BlockLoad {block} />
	{:else}
		<BlockVisible {block} />
	{/if}
{/each}

<p data-after-islands>content after the islands</p>
