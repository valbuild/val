---
"@valbuild/shared": patch
"@valbuild/ui": patch
---

A proposal's typecheck no longer downloads TypeScript again for its second check. The compiler (about 13 MB) is kept by the typecheck's worker once fetched, for every check that asks for the same version after it.
