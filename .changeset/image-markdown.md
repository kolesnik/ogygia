---
'@ogygia/image': minor
'@ogygia/content': minor
---

With `content({ markdown })` and `image()` listed, a local markdown image (`![alt](./photo.jpg)`, relative to the post, spaces and accents included) renders through `<Img>` at the prose width `image({ markdown: { width } })` sets, and a frontmatter value starting with `./` or `../` that names an image becomes a descriptor (accept it in a schema with `v.custom<ImageDescriptor>(isImage)`). A missing file, an HTML `<img>` naming a local file (`image_markdown_html`) and a local image in `import.meta.og.md(text)` (`image_markdown_no_file`) fail the build. `image({ markdown: false })` leaves markdown images as plain `<img>`.
