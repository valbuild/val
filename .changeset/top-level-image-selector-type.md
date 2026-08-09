---
"@valbuild/core": patch
---

Fix `FileSelector` so a top-level `s.image()` type checks as a `ValModule`. The conditional type was written as `Base & Metadata extends undefined ? ... : ...`, which binds the whole intersection into the `extends` check instead of the metadata alone — so the resolved selector lost `url` and its selector base. The conditional is now parenthesised and only the metadata part is conditional.
