# @ogygia/image

Responsive images for [ogygia](https://ogygiajs.dev) apps. The build reads each image once (its size and a tiny blur placeholder) and encodes nothing. Pages ask for the files they need, by preset or by layout, and the image endpoint makes each one the first time it is asked for: in dev, in a prerender (saved as a static file beside the page), or on a live server.

```ts
// vite.config.ts
import { ogygia } from 'ogygia/vite';
import { image } from '@ogygia/image/vite';

export default defineConfig({
	plugins: [
		ogygia(),
		image({
			presets: {
				cover: { layout: 'fullWidth', aspect: '16/9', priority: true },
				thumb: { width: 400, aspect: '1/1' }
			}
		}),
		sveltekit()
	]
});
```

```ts
// src/app.d.ts
/// <reference types="ogygia/types" />
/// <reference types="@ogygia/image/types" />
```

```svelte
<script lang="ts">
	import { Img } from '@ogygia/image';
	const hero = import.meta.og.image('../lib/images/hero.jpg');
</script>

<Img of={hero} preset="cover" alt="The harbor at dusk" />
<Img of={hero} preset="thumb" alt="" />
```

Each file is a signed URL under `/__ogygia__/i/`: a tampered one is refused. A page rendered on a live server can have its files made at build: `import.meta.og.image('./hero.jpg', { warm: 'cover' })` writes the `cover` preset's files as static files. Crops are real files, animated GIFs become animated WebP, SVGs are served as they are, and `<Img>` renders server HTML with no client script and no inline event handler. With `@ogygia/content`, markdown images and `./` frontmatter covers work the same way. Images live under `src/`. See the [docs](https://ogygiajs.dev/docs/content/images).
