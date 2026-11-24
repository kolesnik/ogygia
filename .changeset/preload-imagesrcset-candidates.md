---
'@ogygia/core': patch
---

Island code no longer waits up to 2.5 s for a priority image preload that carries both `href` and `imagesrcset` when the browser fetched one of its `imagesrcset` candidates (a cached hero on a repeat visit, for example): any candidate, or the `href`, counts as the preload's download.
