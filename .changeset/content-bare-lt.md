---
'@ogygia/content': patch
---

A `<` in markdown prose that starts no tag (`if it is < 512KB`, `I <3 it`) is text, as CommonMark reads it: the page shows it instead of failing the build with Svelte's `tag_invalid_name`; a `<` inside a `{…}` expression is left to Svelte.
