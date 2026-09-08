---
"@valbuild/core": minor
---

**Breaking:** `s.images()` is now `s.imageset()`, and `s.files()` is now
`s.fileset()`.

```ts
// before
s.images({ directory: "/public/val/images" });
s.files({ accept: "application/pdf", directory: "/public/val/docs" });

// after
s.imageset({ directory: "/public/val/images" });
s.fileset({ accept: "application/pdf", directory: "/public/val/docs" });
```

Nothing about their behaviour changed — same options, same `.remote()`, same
record-of-metadata content keyed by file path.

The old names were a trap. `s.images()` and `s.image()` differ by one letter,
which reads as "the same thing, but several" — while the real difference is that
`s.imageset()` defines a **whole module** and `s.image()` defines a **field**.
They are not variants of each other, and the plural spelling suggested they were.
`-set` names the container instead, so the two now look as different as they are.

`s.image(imagesetModule)` and `s.file(filesetModule)` are unchanged: that is
still how a field picks one entry out of a set.

If you are also moving off the `remote` option (removed in the same release),
the combined migration is:

```ts
// before
s.images({ directory: "/public/val/images", remote: true });

// after
s.imageset({ directory: "/public/val/images" }).remote();
```

The rename is a hard error rather than a silent one: `s.images` no longer
exists, so an un-migrated call fails immediately in TypeScript and at runtime.
