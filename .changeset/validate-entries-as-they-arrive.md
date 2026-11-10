---
"@valbuild/ui": patch
---

A long `.jsonValues()` record is no longer checked again from scratch each time a set of its entries arrives. While you scroll a record of thousands of posts, the Studio checks only the entries that have just loaded (or that you changed), and the record's own rules (its keys) once. What it reports is the same as before. A schema with no `.validate(...)` anywhere is also no longer searched for one on every check.
