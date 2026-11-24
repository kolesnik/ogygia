<script lang="ts">
	import { Img } from '@ogygia/image';

	const hero = import.meta.og.image('../lib/images/hero.jpg');
	const portrait = import.meta.og.image('../lib/images/portrait.jpg');
	const avatar = import.meta.og.image('../lib/images/avatar.jpg');
	const gallery = import.meta.og.image.glob('../lib/images/gallery/*.jpg');
	const logo = import.meta.og.image('../lib/images/logo.svg');
	const spinner = import.meta.og.image('../lib/images/spinner.gif');
	const badge = import.meta.og.image('../lib/images/badge.png');
</script>

<h1>images</h1>
<Img of={hero} layout="fullWidth" priority alt="Hills at dusk" data-testid="hero" />
<p><Img of={avatar} layout="fixed" width={48} alt="An avatar" data-testid="avatar" /></p>
<div class="spacer"></div>
<Img of={portrait} width={400} alt="A tall picture" data-testid="portrait" />
<Img of={badge} width={160} alt="A round badge" data-testid="badge" />
<Img of={logo} alt="A logo" data-testid="logo" />
<Img of={spinner} alt="A moving dot" data-testid="spinner" />
<ul>
	{#each Object.entries(gallery) as [key, img] (key)}
		<li><Img of={img} width={300} alt={key} data-testid="gallery" /></li>
	{/each}
</ul>
