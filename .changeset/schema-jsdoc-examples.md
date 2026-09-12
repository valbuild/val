---
"@valbuild/core": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
---

Every schema method now has a worked `@example` in its JSDoc, so hovering it in
your editor shows what to write.

That covers the whole builder surface — `.describe()`, `.validate()`,
`.nullable()`, `.readonly()`, `.hidden()`, `.preview()`, `.render()`, and the
per-type methods such as `.minLength()`, `.regexp()`, `.raw()`, `.multiline()`,
`.from()` / `.to()`, `.remote()`, `.jsonValues()` and `.external()` — as well as
`c.define()`, `c.json()`, `c.external()` and the `val` helpers (`val.attrs`,
`val.raw`, `val.unstable_getPath` and friends).

One of the examples corrected a real trap: a custom validator returns
`false | string`, so the natural-looking

```ts
s.string().validate((val) => val.trim() === val || "No surrounding spaces");
```

does not type check — `||` yields `true`, and `true` is not one of the two
answers. Write it as a ternary instead:

```ts
s.string().validate((val) =>
  val.trim() === val ? false : "No surrounding spaces",
);
```

The examples are checked in CI, not just written: one test asks the TypeScript
checker for the doc each method actually resolves to and fails if it has no
`@example`, and another compiles every example it finds.
