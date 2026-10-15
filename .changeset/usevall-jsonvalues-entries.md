---
"@valbuild/tanstack": patch
"@valbuild/next": patch
---

`useVal` and `fetchVal` on a whole `.jsonValues()` record now give every entry's content. They gave each entry back empty in production, on the server and in the browser, because the record holds only a lazy import for each entry; content showed up only where a draft or a hosted content version supplied it. They now load every entry the record names, together. `useValKey` and `fetchValKey` still load only the entry they are asked for, which is the reader to use when a page shows one entry of a large record.
