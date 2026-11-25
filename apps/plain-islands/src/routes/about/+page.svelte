<script lang="ts">
	import Counter from '$lib/Counter.svelte' with { wake: 'load' };
</script>

<h1 data-static-shell>About</h1>

<Counter name="about" start={40} />

<p><a href="/" data-home-link>home</a></p>
