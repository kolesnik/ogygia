---
'@ogygia/image': minor
---

New package `@ogygia/image`: list `image()` from `@ogygia/image/vite` beside `ogygia()`, read an image with `import.meta.og.image('./hero.jpg')` (or many with `import.meta.og.image.glob('./gallery/*.jpg')`), and render it with `<Img of={hero} alt="…" />`. Each image is encoded at build as AVIF and WebP over a width ladder (animated GIFs as animated WebP, SVGs as they are), with a blur placeholder of about 100 bytes; `<Img>` picks the `srcset`, `sizes`, width and height from its `layout` (`constrained`, `fullWidth`, `fixed`) and at most a `width`, crops to a `width` × `height` box, preloads a `priority` image from the head, and renders server HTML with no client script and no inline event handler. `layOut()` gives the same answer outside the component. A missing file, a non-literal argument or an unknown option fails the build with a code.
