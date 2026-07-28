---
"@valbuild/core": patch
"@valbuild/shared": patch
"@valbuild/server": patch
"@valbuild/cli": patch
"@valbuild/ui": patch
---

Allow storing files anywhere under `/public`, not only `/public/val`. Config validation, remote refs, and the studio file/image fields now accept any `/public/...` directory (the default remains `/public/val`). Also removed the `files` property from `SharedValConfig` — the per-schema `s.files`/`s.images` directory is now the source of truth.
