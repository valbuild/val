---
"@valbuild/ui": minor
---

Four new AI chat tools for working with content structure.

`duplicate_source` copies the value at one path to another in the same module. Copying an existing entry is usually better than building one from scratch: nested structure, optional fields and image references all come along intact.

`empty_at_path` creates an empty value derived from the schema, for when there is no similar entry to copy from.

Both pick the JSON patch op from the destination's parent — `add` for an array or record entry, `replace` for an object slot — and redirect to `create_patch` or `add_session_image_to_gallery` when the destination is richtext or an images gallery, rather than producing a patch that cannot work there.

`count_entries` and `get_record_keys` answer "how many are there?" and "which keys exist?" without pulling a whole module into the conversation. `get_record_keys` pages through the keys.
