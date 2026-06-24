---
"@valbuild/core": patch
---

Add key validation support to `s.router` (mirroring `s.record`). Pass a string schema as the second argument to attach `.maxLength()`, `.regexp()`, `.validate()`, `.describe()`, etc. to router keys — for example `s.router(nextAppRouter, s.string().maxLength(60).describe("URL slug"), s.object({ ... }))`. Router URL pattern validation continues to run, and both error sources now surface together at the same key path.
