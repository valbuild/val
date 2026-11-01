---
"@valbuild/tanstack": patch
"@valbuild/next": patch
---

In draft mode, `fetchVal` of a whole `.jsonValues()` record now shows the
pending edits to its entries. It used to show the published content of every
entry, even one an editor had just changed, while `fetchValKey` and
`fetchValRoute` of the same entry showed the edit. The entries an unpublished
change touches are now read from Val's server; the others are loaded from the
bundle as before.
