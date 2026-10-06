---
"@valbuild/server": patch
"@valbuild/ui": patch
---

A project with `files: { remote: true }` can save text edits in local development without `val login` or a project id.

Before, a local save asked for remote credentials whenever any schema in the project was remote. With `files: { remote: true }` that is every media schema, so every save was refused, even a typo fix. Now it asks only when the change being saved contains a remote file.

The "remote files are not configured" banner can now be dismissed. It used to cover the top of the Studio, the Publish button included, for as long as the Studio was open.
