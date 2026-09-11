---
"@valbuild/ui": patch
"@valbuild/shared": patch
---

Discarding changes now clears the validation errors, previews and search results
that were computed from them.

A discard that removed a module's last pending change announced itself only as
a "drop", and the stores that keep validation results, previews and the search
index listened only for changes being applied. So after discarding, the Studio
kept showing the errors and previews of the discarded edit until something else
touched the module.

Fields that reference another module's keys (`s.keyOf(...)` and `s.route()`)
also follow that module now. Renaming a page and then discarding the rename left
every `keyOf` field pointing at it reporting that the key does not exist — about
a key that was back — because the module holding the reference had not changed
and was never re-checked. The validation store now tracks which records a
module's errors resolve against and re-checks it when their keys change, and only
then: editing content inside a referenced page does not re-validate its
referrers.
