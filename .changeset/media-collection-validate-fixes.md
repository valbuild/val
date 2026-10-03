---
"@valbuild/core": patch
"@valbuild/shared": patch
"@valbuild/server": patch
"@valbuild/ui": patch
"@valbuild/cli": patch
---

Fixes to `npx val validate` for `s.imageset()` and `s.fileset()`, and the `s.image(galleryVal)` / `s.file(filesVal)` fields that use them:

- **`--fix` now updates every field that uses an uploaded image or file.** When `--fix` moves an entry of an `s.imageset().remote()` or `s.fileset().remote()` to Val Remote, the entry's key changes from the local path to the remote URL. Fields that held the old path were left pointing at it, and reported "The gallery does not have an image at …" with nothing to fix it. Now `s.image(galleryVal)` and `s.file(filesVal)` fields, and images in rich text (`s.richtext({ img: s.image(galleryVal) })`), are updated in the same run. The VS Code extension's "upload to Val Remote" updates them in the same edit.
- **A field that uses an image or file from a `.remote()` gallery is no longer reported as "Expected local image, but found remote".** The gallery decides whether its files are on Val Remote; the field only has to name a file the gallery has. Before, `--fix` would download the file and point the field at a path the gallery did not have.
- **Images uploaded through a field into a `.remote()` gallery.** When you upload an image through an `s.image(galleryVal)` field in Val Studio, the field stores the remote URL and the gallery stores the image under its local path. Validation now accepts this, and `useVal` / `fetchVal` now fill in the image's `width`, `height` and `mimeType` from the gallery for it, as they do for every other gallery image.
- **Errors in a gallery's keys are reported.** A remote URL in a gallery that is not `.remote()`, a remote URL that is not valid, or one outside the gallery's `dir` was silently ignored by `npx val validate`. It is now reported as an error. `--fix` does not change it: you decide whether the key or the gallery's options are wrong.
- **A file is no longer reported as valid when it still has an error.** When `--fix` fixed one error in a file and another error was left, the file could be printed as "✔ valid".
