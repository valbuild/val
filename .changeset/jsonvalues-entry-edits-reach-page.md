---
"@valbuild/ui": patch
---

Edits inside a `.jsonValues()` entry now show up in the Studio and on the page
in every case:

- An edit made to an entry this tab had not opened yet (by another editor, the
  assistant, or before the entry loaded) is applied when the entry loads. It
  used to stay unapplied, so the field and the page's preview showed the
  published entry while Val's server had the edit.
- Renaming an entry keeps its content in the preview, instead of showing it
  empty until the next reload.
- When another tab publishes or discards an edit to an entry, it is read again,
  instead of going back to what it said before the publish.

The browser console no longer reports "a patch could not be applied … Keeping
it" as an error; it is expected while an entry loads, and is logged only with
debug logging on.
