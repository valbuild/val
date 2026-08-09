---
"@valbuild/core": patch
"@valbuild/server": patch
"@valbuild/cli": patch
---

Validation errors from the CLI now point at the offending location in the `.val.ts` file. Each error shows a clickable `file:line:col` and a code frame (the line above, the offending line, and the line below) with carets underlining the exact source. The carets target the **value** by default and the **key** when the error is about an object/record key (`keyError`). Gallery metadata errors now point at the specific record entry instead of the whole module.

Gallery/media collection entry errors are now marked as `keyError`, so the CLI underlines the entry's file-path key rather than the derived metadata value. Alt-text errors keep pointing at the alt value.

The module-path → source-range utility used for this (`createModulePathMap`, `getModulePathRange`, `ModulePathMap`) is now exported from `@valbuild/server`.
