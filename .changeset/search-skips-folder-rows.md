---
"@valbuild/ui": patch
---

Global search no longer offers route patterns as pages

Searching (⌘K) listed a row for every node in the site map, including the rows
that are only path segments. `/blogs` is in the site map because
`/blogs/blog-1` is; it has no content of its own, and the only URL it has is
the route PATTERN its children share. So the second row of the search in a
project with an `/app/blogs/[blog]/page.val.ts` was `/blogs/[blog]` — a page
that does not exist.

Selecting it made that concrete. Such a row has no source path, so
`findShellSelection` could not resolve it, and the fallback — which exists for
content hits, whose id IS a source path — took the row's id (the pattern) and
navigated to it, landing the Studio on `/val/~/blogs/[blog]`.

These rows are now skipped when the search rows are collected, and their
children are still walked, so the pages under a folder are found as before. The
Pages panel is unchanged: there a folder row expands, which is what it is for.
The fallback is now taken only for the two kinds of row whose id is a source
path, so an unresolvable navigation row does nothing instead of navigating
somewhere that is not there.
