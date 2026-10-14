---
"@valbuild/core": patch
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/ui": patch
"@valbuild/language-server": patch
---

Remote files served from a project's own site (addresses like
`https://www.acme.no/_val/file/…`) are now checked for whether that address
still serves the project. When a custom domain has been removed or moved to
another project, the image or file is reported, and **Fix** on the Studio's
Validate page — or `val validate --fix` — points it at the project's permanent
`<id>.valstart.dev` address. Nothing is uploaded or downloaded: only the address
changes.

Remote file addresses with a `/_val` prefix after the host are now recognised.
