<script lang="ts">
	let { start = 0, name }: { start?: number; name: string } = $props();
	// svelte-ignore state_referenced_locally
	let count = $state(start);
</script>

<div class="island" data-counter={name}>
	<strong>{name}</strong>:
	<button onclick={() => (count += 1)}>count is {count}</button>
</div>
