---
"@valbuild/server": patch
"@valbuild/cli": patch
---

Validation errors from the CLI now point at the offending location in the `.val.ts` file. Each error shows a clickable `file:line:col` and a code frame (the line above, the offending line, and the line below) with carets underlining the exact source. The carets target the **value** by default and the **key** when the error is about an object/record key (`keyError`), and the output is labelled `(key)` / `(value)` accordingly. Gallery metadata errors now point at the specific record entry instead of the whole module.

The module-path → source-range utility used for this (`createModulePathMap`, `getModulePathRange`, `ModulePathMap`) is now exported from `@valbuild/server`.
