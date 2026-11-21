<script lang="ts">
	// The restore lab with nothing reshaped in the document: only the hole's answer holds a host. The
	// document carries no restorer, so the rewrite realm loads its own copy, and the answer waits for it.
	import HoleCard from '$lib/restorelab/HoleCard.svelte' with { render: 'deferred' };
</script>

<h1>restore lab, the hole alone</h1>
<HoleCard>
	{#snippet ogygiaFallback()}<p data-hole-fallback>loading the hole…</p>{/snippet}
</HoleCard>
