---
"@valbuild/ui": patch
---

A record's **Add** form now refuses a key the record already has. It used to accept one, and the new entry replaced the old one; and it refused a new key spelled like a number ("0", "12") on a record with that many entries.

Scrolling a long `.jsonValues()` record is also smoother: the list no longer works out every key of the record each time a set of entries arrives.
