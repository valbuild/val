---
"@valbuild/shared": patch
---

Stop `@valbuild/shared` replacing a consumer's own flexsearch types

`@valbuild/shared` gained a flexsearch dependency in 0.123.0, for
`search_content`, and typed its exported `SearchIndex.index` as flexsearch's
own `Index`. That put `import { Index } from "flexsearch"` into the published
`searchIndex.d.ts` — and flexsearch's type entry opens with
`declare module "flexsearch"`, which is an AMBIENT module declaration and so
global to a whole TypeScript program.

The effect on a project that uses flexsearch itself, at a different version:
its own calls are checked against the copy Val dragged in. valbuild/web pins
flexsearch 0.7 and builds an index with
`new flexsearch.Document({ language: "en", … })`; on `@valbuild/shared@0.123.2`
that stopped compiling, because 0.8's `DocumentOptions` has no `language`. Its
resolved copy was still 0.7 — only the types had been swapped underneath it.

`SearchIndex.index` is now a structural type covering the three methods this
package calls, so nothing in the published declarations names flexsearch. The
library is still used to build the index; that is a value import, which never
reaches a `.d.ts`.

No API change: `SearchIndex` is still assignable from a real flexsearch
`Index`, and `noFlexsearchInPublishedTypes.test.ts` asserts both halves of that
— that no source file names flexsearch in a type position, and that a real
`Index` still satisfies the stand-in, so it cannot drift from the library
unnoticed.
