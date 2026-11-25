---
'@ogygia/federation': patch
---

A fragment's CSS backgrounds load from the app that rendered it: an image a `style` attribute names with `url(…)` (a `layOut()` background, say) is pinned to the peer's origin. Before, it pointed at the host page's server.
