---
"@valbuild/server": patch
"@valbuild/ui": patch
---

**Entries the design tab adds to a `.jsonValues()` record no longer revert.** When the design tab added an entry to a record that keeps its entries in `.val.json` files, the proposal's stored content didn't list the new entry, so edits to it went back. A staged `.val.ts` now sends the record's entries with it, as the stored content lists them.

**The design tab's `create_patch` can edit inside a `.jsonValues()` entry.** A patch into an entry is written into that entry's own `.val.json`, formatted the way a save writes it, so the assistant no longer rewrites the whole file to change one field. Adding, replacing or removing a whole entry still goes through `write_files`.
