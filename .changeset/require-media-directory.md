---
"@valbuild/core": minor
---

**Breaking:** `directory` is now required on `s.images()` and `s.files()`

It used to default to `/public/val`. That default was silent and shared: two
collections that had simply not said where they wanted their files landed in the
same directory, which `images:check-unique-folder` then reports as a collision the
author never chose. Where uploads go is not something to infer.

```diff
- s.images({ accept: "image/webp" })
+ s.images({ directory: "/public/val/images", accept: "image/webp" })

- s.files({ accept: "application/pdf" })
+ s.files({ directory: "/public/val/documents", accept: "application/pdf" })
```

To keep the previous behaviour exactly, pass `directory: "/public/val"`.

`s.images()` with no arguments no longer typechecks. Note also that the runtime
fallback is gone along with the default, so a JavaScript caller that omits
`directory` now serializes `directory: undefined` rather than `/public/val`;
TypeScript callers cannot reach that.
