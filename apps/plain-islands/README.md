# plain-islands

The plainest ogygia app: `csr = false` pages whose regions are islands and nothing else. No
deferred hole, no lake, no held region, no router. Its build's feature word has no frames bit, so
the region element's hole and live programs fold out of the boot.

Internal. Never published or deployed. Its one user is
`apps/palaestra/e2e/plain-islands.spec.ts`, which builds this app with ogygia's rules on, checks
the boot holds neither program, serves it, and checks each island wakes in a browser.
