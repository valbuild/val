---
"@valbuild/language-server": patch
"@valbuild/cli": patch
"@valbuild/next": patch
---

Publish the packages that 0.120.1 did not reach.

`@valbuild/server@0.120.1` made it to npm, but `@valbuild/cli`,
`@valbuild/language-server` and `@valbuild/next` did not — the release job
failed part-way through, and the version numbers it had already claimed could
not be reused. This release carries the same contents for those three packages:
they pick up the MCP signing-key rotation fix from `@valbuild/server@0.120.1`,
and there is nothing else in it.

If you are on 0.120.0, upgrade straight to this version. There is no 0.120.1 of
these three packages, and there will not be one.
