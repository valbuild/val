---
"@valbuild/server": patch
"@valbuild/ui": patch
---

A project with `files: { remote: true }` can save text edits without remote-file credentials: in local development without `val login` or a project id, and on a server without `VAL_API_KEY`.

Before, a save asked for remote credentials whenever any schema in the project was remote. With `files: { remote: true }` that is every media schema, so every save was refused, even a typo fix. Now it asks only when the change being saved contains a remote file.

When uploads are unavailable, the Studio now shows a card above the editor. It says what is wrong and gives the fix: a link to admin.val.build or the `val login` command to copy. When the cause is missing setup (no project id, not logged in, no API key) it also says that text edits still save and publish. Dismissing it leaves an "Uploads off" item in the status bar, or in the account sheet on a phone, that brings it back. This replaces the red bar that covered the top of the Studio, the Publish button included, and the login dialog that opened on every load.
