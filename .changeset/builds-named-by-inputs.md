---
"@valbuild/tanstack-build": patch
"@valbuild/shared": patch
"@valbuild/ui": patch
---

A build is now named by what it was built from rather than by what it produced, so publishing the same project files again reuses the build the site already has. When that build is still held, the Studio skips building and uploading it.
