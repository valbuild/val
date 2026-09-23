---
"@valbuild/language-server": patch
"@valbuild/server": patch
---

A `*.val.ts` with no default export is no longer reported as a missing module

`*.val.ts` is a naming convention, not a promise: plenty of files under it hold
only the schemas and helpers the modules beside them import. Every one of those
was getting two errors in the editor — `Module '…' was not found in
val.modules` and `… is not registered in val.modules, so Val will not serve it`
— both on line 1, telling their author to register a file that has nothing to
register. `val validate` has never reported them; only the editor did.

The default export is what makes a `*.val.ts` a module, so that is what the
diagnostic now asks about:

- **No default export → nothing is reported.** The file is not a module, so it
  is not a module Val is failing to serve.
- **A default export → one diagnostic, on the `export default` itself** rather
  than on line 1, so it is next to the thing that has to change, and the
  duplicate fatal beside it is gone. The message now gives both remedies: add
  the file to `val.modules`, or export what it holds by name instead. The "Val:
  register … in val.modules" quick fix is offered there.

The rule is `findDefaultExport` in `@valbuild/server`, which `val validate`
already used to decide the same question — so the editor and the CLI now agree
about which files are modules, including the cases that are easy to get wrong
(`export * from …` carries no default; `export type { T as default }` and
`export default interface T {}` are both gone after transpilation).

Because the diagnostic now replaces a module's own findings rather than adding
to them, the editor also stops guessing about registration it cannot read: a
`val.modules` that registers modules through a tsconfig path alias
(`import("_/content/page.val")`), or that builds its list in another file, is no
longer taken to register nothing.
