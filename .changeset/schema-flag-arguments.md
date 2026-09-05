---
"@valbuild/core": patch
"@valbuild/next": patch
---

`.readonly()` and `.hidden()` now take the flag as an argument, so a schema can
decide these from a variable instead of only from whether the call was written at
all:

```ts
s.string().readonly(!canEdit);
s.image().hidden(hideMedia);
```

The argument defaults to `true`, so `.readonly()` and `.readonly(true)` are the
same thing and nothing about existing schemas changes. Passing `false` leaves the
field editable or visible, which is also what a schema is without the call - it
is there so the flag can come from a variable.
