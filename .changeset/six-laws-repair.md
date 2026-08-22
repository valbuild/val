---
"@valbuild/ui": patch
---

Rework the left navigation.

- **Pages** shows validation errors per row, with a badge that says how many are in the row itself versus below it, and the add-page form is shared between the section header and each row rather than reimplemented per site.
- **Media** is a new section for `s.images()` / `s.files()` galleries. A gallery is a record keyed by file path, so in Explorer it presented as a `.val.ts` holding a record of paths — the least useful view of it. Galleries are now listed by the directory each is constrained to, and selecting one opens the gallery. They no longer also appear in Explorer: two entry points to one module is confusing, and the Explorer one opens the wrong view.
- **`s.route()` fields can create what they link to.** Linking to a page that does not exist yet meant leaving the field, creating the page, and coming back. The dropdown now offers "New page" — reusing the same form the sitemap uses, so the router picker, duplicate detection and the key description all apply — and "New external page", which validates the `https://` / `http://` rule the external router enforces server-side while the editor types.
