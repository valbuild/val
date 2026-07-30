---
"@valbuild/core": patch
"@valbuild/ui": patch
---

Add key validation support to `s.router` (mirroring `s.record`). Pass a string schema as the second argument to attach `.maxLength()`, `.regexp()`, `.validate()`, `.describe()`, etc. to router keys — for example `s.router(nextAppRouter, s.string().maxLength(60).describe("URL slug"), s.object({ ... }))`. Router URL pattern validation continues to run, and both error sources now surface together at the same key path. Validation errors on the same path are now merged instead of overwritten, so router, key and item errors on a key are all reported. The key description is also shown when adding or renaming a route from the sitemap.
