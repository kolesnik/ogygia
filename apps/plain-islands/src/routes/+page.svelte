<script lang="ts">
	import Counter from '$lib/Counter.svelte' with { wake: 'load' };
	import IdleCounter from '$lib/Counter.svelte' with { wake: 'idle' };
	import ClickCounter from '$lib/Counter.svelte' with { wake: 'interaction' };
	import LowCounter from '$lib/Counter.svelte' with { wake: 'visible' };
</script>

<h1 data-static-shell>Plain islands</h1>
<p data-static-shell>Server HTML, and four islands that each wake their own way.</p>

<Counter name="load" start={1} />
<IdleCounter name="idle" start={10} />
<ClickCounter name="interaction" start={20} />

<p><a href="/about" data-about-link>about</a></p>

<div style="height: 3000px" data-spacer></div>

<LowCounter name="visible" start={30} />
