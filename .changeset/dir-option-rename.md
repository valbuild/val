---
"@valbuild/core": minor
---

**Breaking:** the `directory` option is now `dir`, on every schema that takes
it — `s.imageset()`, `s.fileset()` and `s.image()`.

```ts
// before
s.imageset({ directory: "/public/val/images" });
s.fileset({ accept: "application/pdf", directory: "/public/val/docs" });
s.image({ directory: "/public/val/heroes" });

// after
s.imageset({ dir: "/public/val/images" });
s.fileset({ accept: "application/pdf", dir: "/public/val/docs" });
s.image({ dir: "/public/val/heroes" });
```

Same meaning: where uploads for that schema land. Still required on
`s.imageset()` and `s.fileset()`, still optional on `s.image()`.

**`files.directory` in `val.config.ts` is NOT renamed.** That is the
project-wide files directory, a different option with a different scope, and it
keeps its name.

One consequence worth knowing: `dir` is part of the serialized schema, and the
serialized schema is what a remote file's validation hash is computed from. So
already-published remote files that came from a schema setting this option get
one re-validation on upgrade — Val re-downloads, re-checks and rewrites the ref
with the new hash. This is the same path a core version bump already takes, and
it needs no action.
