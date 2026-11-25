<script lang="ts">
	import type { Snippet } from 'svelte';
	import { Img } from '@ogygia/image';

	let { children }: { children: Snippet } = $props();
	const mark = import.meta.og.image('../lib/images/avatar.jpg');
</script>

<header><Img of={mark} preset="avatar" alt="The site's mark" id="site-mark" /></header>
{@render children()}
