---
"@valbuild/server": patch
"@valbuild/ui": patch
---

A project with `files: { remote: true }` can save text edits in local development without `val login` or a project id.

Before, a local save asked for remote credentials whenever any schema in the project was remote. With `files: { remote: true }` that is every media schema, so every save was refused, even a typo fix. Now it asks only when the change being saved contains a remote file.

When uploads are unavailable (no project id, not logged in, no API key, or the remote host can't be reached), the Studio now shows a card above the editor. It says what is wrong, notes that text edits still work, and gives the fix: a link to admin.val.build or the `val login` command to copy. Dismissing it leaves an "Uploads off" item in the status bar that brings it back. This replaces the red bar that covered the top of the Studio, the Publish button included, and the login dialog that opened on every load.
