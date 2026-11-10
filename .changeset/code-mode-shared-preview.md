---
"@valbuild/ui": patch
---

**Code mode uses the Studio's own preview.** Code mode used to replace the
editor and the preview with a separate view of the proposal's site, where
nothing could be selected and content edits did not show. Now the preview is
the same in every mode:

- In code mode the column beside the preview shows the code changes, with
  **Edit content** to go back to the content editor. Selecting a field on the
  page does the same.
- The preview has the same device sizes, zoom, reload and selection as
  everywhere else, and shows content edits as you type.
- The assistant sits beside the preview in code mode instead of over it.
- The preview loads the page again whenever the proposal serves a new build,
  whoever built it.
