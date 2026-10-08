---
"@valbuild/server": patch
---

`createFixPatch` reads a file's bytes, and saves a downloaded remote file,
through an optional `files` reader instead of directly from disk. The default
reads the disk under `projectRoot` exactly as before, so `val validate --fix`
and the VS Code extension behave the same.
