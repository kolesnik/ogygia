<script lang="ts">
	import { Region } from 'ogygia';
	import { Img } from '@ogygia/image';
	let { data } = $props();
</script>

<article>
	<Img of={data.cover} layout="fullWidth" priority alt={data.title} data-testid="cover" />
	<h1>{data.title}</h1>
	<Region of={data.body} />
</article>
