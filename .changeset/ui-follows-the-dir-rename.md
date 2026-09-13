---
"@valbuild/ui": patch
---

Republish the Studio so it reads `dir`, the key `@valbuild/core` now serializes.

0.128.0 renamed the media schema option `directory` to `dir`, and that rename
reaches the serialized schema the Studio reads. `@valbuild/ui` was not
republished with it — it declares `@valbuild/core` and `@valbuild/shared` as
devDependencies, so changesets did not see it as a dependent — and
`@valbuild/server`, `@valbuild/next`, `@valbuild/react` and `@valbuild/tanstack`
all pin `@valbuild/ui` exactly. So 0.128.0 shipped a Studio built before the
rename, reading a key that core no longer emits.

Two things broke for anyone on 0.128.0, both silently:

- **Uploads landed in the wrong directory.** `ImageField` and `FileField`
  resolve where a file goes from `options.dir` or, for a gallery-backed field,
  the gallery's `dir`. Reading the old key gave `undefined`, so every upload
  fell back to `/public/val` — outside the directory the schema names, which
  then fails validation. This is the same failure the example app records as
  previously fixed.
- **The Media nav lost its labels.** Galleries are listed and sorted by their
  directory; with the old key that fell back to the module path, so every
  gallery was labelled by file rather than by the directory an editor thinks in.

Nothing in the Studio's source changed here — 0.128.0 already had the correct
code. This publishes it.
