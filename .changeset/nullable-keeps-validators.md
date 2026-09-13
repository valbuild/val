---
"@valbuild/core": patch
"@valbuild/next": patch
---

`.nullable()` no longer drops the field's `.validate(...)` functions.

`.nullable()` returns a copy of the schema, and most of the schema classes built
that copy with an empty list of custom validators — so a validator declared
before the `.nullable()` was silently thrown away:

```ts
s.number()
  .validate((n) => (n > 100 ? "Too big" : false))
  .nullable(); // the validator never ran
```

`array`, `object`, `discriminatedUnion`, `enum`, `number`, `boolean`, `literal`,
`keyOf`, `date`, `dateTime`, `code`, `color` and `richtext` were affected;
`string`, `record`, `route`, `file` and `image` already carried them over, which
is why the bug was easy to miss. Validators now survive `.nullable()` on every
schema, in either order.

A validator on a nullable schema is called with `null` when the value is unset,
rather than being skipped — the same thing the schemas that never dropped them
have always done. If yours was written before the `.nullable()`, its argument is
typed as non-null even though `null` can reach it, so guard for it.
