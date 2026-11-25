---
'@ogygia/image': minor
---

`vercel({ sizes?, qualities? })` from `@ogygia/image/vite` is an encoder for adapter-vercel: a page rendered on request names each file as a Vercel Image Optimization link (`/_vercel/image?url=…&w=…&q=…`), its width snapped up to `sizes`, AVIF or WebP picked by Vercel from the browser's `Accept`; hand `encoder.images` to the adapter (`adapter({ images })`). Prerendered pages still name the files the build makes.
`image({ encoder: [vercel(), sharp()] })`: in a list, the first encoder that can make a file makes it, so the crops, positions, operations, named PNG or JPEG, and GIF, TIFF or animated sources Vercel cannot make go to the app's own sharp endpoint; with `vercel()` alone they fail to render with `image_encoder_cannot`.
A build that lists `vercel()` fails with `image_vercel_config` when adapter-vercel's `.vercel/output/config.json` `images` lacks a width, quality or format the app names, or the host of a full-URL `paths.assets`, or when the adapter is not adapter-vercel.
