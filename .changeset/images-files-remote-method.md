---
"@valbuild/core": minor
---

**Breaking:** `s.images()` and `s.files()` no longer take a `remote` option. Use
`.remote()`, the same way `s.image()` and `s.file()` already did.

```ts
// before
s.images({ directory: "/public/val/images", remote: true });
s.files({
  directory: "/public/val/docs",
  accept: "application/pdf",
  remote: true,
});

// after
s.images({ directory: "/public/val/images" }).remote();
s.files({ directory: "/public/val/docs", accept: "application/pdf" }).remote();
```

Behaviour is unchanged — remote is still off unless asked for. This only makes
remote one thing spelled one way across all four media schemas, instead of an
option on the two collections and a method on the two fields. `remote: false`
has no replacement because it was the default; drop it.
