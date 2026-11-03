---
"@valbuild/server": patch
"@valbuild/shared": patch
---

Unpublished edits are now applied the same way everywhere the server reads
them, and a few cases that showed something different from what Publish would
save are fixed:

- A field you emptied to `null`, `""`, `0` or `false` no longer jumps back to
  its published value at your next edit.
- When an edit cannot be applied, later edits to `.jsonValues()` entries stop
  there too, instead of showing an entry the page will never get.
- An image or file added to a `.jsonValues()` entry no longer fails the whole
  entry when the upload comes before the field in the edit.
- Clearing a nullable `.jsonValues()` record removes its entries from drafts
  as well.

Long chains of unpublished edits are also much faster to read: a draft with
650 edits went from about 580 ms to about 110 ms.
