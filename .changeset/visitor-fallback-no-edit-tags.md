---
"@valbuild/tanstack": patch
"@valbuild/next": patch
---

When `fetchVal` fails and falls back to the content it has, a visitor (draft
mode off) no longer gets that content with Val's invisible edit tags in it.
They are only for editors, and on a public page they could end up in a
`<title>`, a link or JSON-LD.
