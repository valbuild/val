---
"@valbuild/core": minor
"@valbuild/shared": minor
"@valbuild/server": minor
"@valbuild/cli": minor
"@valbuild/ui": minor
---

A `.jsonValues()` record now TYPECHECKS an entry written inline, and `val validate` reports and fixes it.

Writing an entry directly in the `.val.ts` instead of `c.json(() => import(...))` used to be a type error:

```ts
c.define(
  "/test.val.ts",
  s.record(s.object({ field: s.string() })).jsonValues(),
  {
    test1: c.json(() => import("./test/test1.val.json")),
    // Object literal may only specify known properties,
    // and 'field' does not exist in type 'JsonSource<...>'
    inlined: { field: "legal" },
  },
);
```

The error was a dead end: it points at the value, not at what to write instead, and it fires on the natural first thing an author reaches for (hand-writing an entry, or pasting one over from an ordinary record). The entry type now also accepts the item's own shape — a wrong inline value (`{ field: 1 }`) is still a type error.

Validation is what catches the inlining. `val validate` reports it as a fixable error on the entry, and `--fix` moves the value into its conventional `*.val.json` and rewrites the module to reference it:

```
content/kb.val.ts  ✘ 1 error (1 fixable)
│  ⚠  content/kb.val.ts:172:18
│     Entry 'kb-inline' is written inline in /content/kb.val.ts, but this record
│     uses .jsonValues(): entry values must live in their own '*.val.json' file…
```

The Studio surfaces the same error (new fix code `jsonValues:extract-entry`); it cannot repair it in the browser, since the fix writes a new file and rewrites the module.
