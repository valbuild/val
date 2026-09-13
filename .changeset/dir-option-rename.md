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

`dir` is the serialized name too, and two things follow from that. Neither
needs any action, but both are worth knowing:

- **History still reads pre-rename commits.** A commit record stores the schema
  each module was under, so commits from before this release carry `directory`.
  The serialized-schema parser accepts that key and reads it as `dir`, which is
  what keeps a historical gallery from showing up with no directory at all.
- **Published remote files re-validate once.** The serialized schema is what a
  remote file's validation hash is computed from, so a file uploaded under a
  schema that sets this option gets one re-download and re-check, after which
  the ref is rewritten with the new hash. This is the same self-healing path a
  core version bump already takes.
