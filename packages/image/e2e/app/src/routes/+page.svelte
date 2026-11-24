<script lang="ts">
	import { Img } from '@ogygia/image';
	import Counter from '$lib/islands/Counter.svelte' with { wake: 'load' };

	const hero = import.meta.og.image('../lib/images/hero.jpg');
	const portrait = import.meta.og.image('../lib/images/portrait.jpg');
	const avatar = import.meta.og.image('../lib/images/avatar.jpg');
	const gallery = import.meta.og.image.glob('../lib/images/gallery/*.jpg');
	const logo = import.meta.og.image('../lib/images/logo.svg');
	const spinner = import.meta.og.image('../lib/images/spinner.gif');
	const badge = import.meta.og.image('../lib/images/badge.png');
</script>

<h1>images</h1>
<a href="/blog/first-post" id="to-post">The first post</a>
<Counter />
<Img of={hero} layout="fullWidth" priority alt="Hills at dusk" id="hero" />
<p><Img of={avatar} layout="fixed" width={48} alt="An avatar" id="avatar" /></p>
<div class="spacer"></div>
<Img of={portrait} width={400} alt="A tall picture" id="portrait" title="Tall" />
<Img of={hero} width={400} height={400} alt="Hills, cropped square" id="crop" />
<Img of={badge} width={160} alt="A round badge" id="badge" />
<Img of={logo} alt="A logo" id="logo" />
<Img of={spinner} alt="A moving dot" id="spinner" />
<ul>
	{#each Object.entries(gallery) as [key, img] (key)}
		<li><Img of={img} width={300} alt={key} class="gallery" /></li>
	{/each}
</ul>
