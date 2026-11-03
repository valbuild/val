---
"@valbuild/core": patch
"@valbuild/server": patch
"@valbuild/react": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
"@valbuild/ui": patch
---

**A draft page shows the right `.jsonValues()` entries, whichever reader reads them.**

- **Pending edits to an entry.** In draft mode, `fetchVal` of a whole
  `.jsonValues()` record now shows the unpublished edits to its entries. It
  used to show the published content of every entry, even one an editor had
  just changed, while `fetchValKey` and `fetchValRoute` of the same entry
  showed the edit. The entries a pending change touches are read from Val's
  server; the others are loaded from your build, as before.
- **Entries published without a rebuild.** On a host that does not rebuild
  the site after a publish, a draft page now shows the published entries
  straight away -- in `fetchVal`, and in `useVal`, `useValKey` and
  `useValRoute` alike. They used to show those entries as they were before
  the publish, from the site's build, until it was rebuilt (and on TanStack
  Start the server render showed the new content, then the page switched
  back to the old). Val's server marks each entry a publish wrote, and the
  readers and the Studio load a marked entry from the server.
