<script lang="ts">
	import { Region } from 'ogygia';
	import { Img } from '@ogygia/image';
	let { data } = $props();
</script>

<article>
	<Img of={data.cover} preset="cover" alt={data.title} id="cover" />
	<h1>{data.title}</h1>
	<Region of={data.body} />
</article>
