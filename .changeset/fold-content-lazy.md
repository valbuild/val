---
"@valbuild/server": patch
---

A site's pages no longer load the TypeScript compiler

`foldContent`, new in `@valbuild/server/internal`, was exported in a way that loaded the TypeScript compiler with that entry, which is also what a site's pages read their content through. It is now loaded only when it is called, so a page a visitor opens evaluates none of it again.
