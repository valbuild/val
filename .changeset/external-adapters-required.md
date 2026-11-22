---
"@valbuild/core": patch
"@valbuild/server": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
---

A project with `s.record(...).external("label")` modules is now told at compile time when their adapters are missing.

- `initValServer` and the content readers (`initValContent` in `@valbuild/tanstack/server`, `initValRsc` in `@valbuild/next/rsc`) require an `external` option when `val.modules.ts` registers an external module, and it has to bind every label those modules declare. Leaving it out, or binding only some of them, is a type error that names the missing label. A project with no external modules is asked for nothing.
- `modules(config, [...])` now keeps the type of each module it is given, which is how the entry points know. `ValModules` takes that as an optional type parameter, so code that names `ValModules` is unaffected. Annotating the export of `val.modules.ts` as plain `ValModules` opts out of the check.
- `defineExternal`, `ok`, `err` and the adapter types are exported from `@valbuild/next/server` and `@valbuild/tanstack/server`, so the file that holds a project's adapters imports from the same package as `initValServer`.
- New types in `@valbuild/core`: `ValExternalModule<Item, Label, Readonly>` (what `c.define` returns for an external record), `ValModuleDef` and `ExternalLabelsOfModules`.

External records are still a contract only: `defineExternal` is not implemented yet, so nothing reads the registry at runtime.
