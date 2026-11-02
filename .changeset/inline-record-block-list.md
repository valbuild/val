---
"@valbuild/ui": patch
---

Inline records (`s.record(...).render({ as: "inline" })`) now look and work like inline arrays. Each entry is a row named by its key, the row's ⋮ menu has **Rename**, **Duplicate** and **Delete**, and **Add** asks for the new key. Records have no order, so their rows have no drag handle.

Inline lists are also tighter and easier to read:

- Nested lists are indented under their label, and their **Add** sits on that label's row, so the Add buttons no longer stack at the end of each level.
- Field labels inside a row are title-cased like everywhere else in the Studio, and a field's `.describe(...)` text is now shown under its label.
- A union row shows which variant it is in its header, so a collapsed block still says what it is. The variant picker is labelled too.
- An inline `keyOf` shows the entry it points to with the same compact layout as the row around it.
- A read-only list no longer shows drag handles.
