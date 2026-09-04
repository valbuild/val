---
"@valbuild/ui": patch
---

Add a referenced entry from a `s.keyOf()` field

A `keyOf` field can now create the entry it is about to point at. Where the
author you want is not in the authors record yet, name them here: the entry is
added to the referenced record, the field points at it, and you are taken to the
new entry to fill it in — instead of leaving the page you were editing to create
it and coming back to link it.

- Two ways in, as reference fields normally have: **New entry** at the foot of
  the dropdown, and a **+** beside it for when you have not opened the dropdown.
- The key you searched for is what the new entry is named, and the option stays
  offered when the search matches nothing — which is how you got there.
- The key box says what a key is here, from the record's `key` description (or
  the field's own).
- A key that already exists is refused rather than overwriting that entry.
- Where the field renders the entry inline, it stays put: the new entry's fields
  are already on screen.
- Only for a record — an object's keys are its schema. A router record asks for
  the new key per route segment, the same form the sitemap's "Add page" uses.
