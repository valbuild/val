# @valbuild/language-server

## 0.118.0

### Patch Changes

- Updated dependencies [[`198ba8b`](https://github.com/valbuild/val/commit/198ba8bd8e6c921660e97f5cd26fb17f2d5f3f95)]:
  - @valbuild/server@0.118.0
  - @valbuild/shared@0.118.0

## 0.117.1

### Patch Changes

- Updated dependencies []:
  - @valbuild/server@0.117.1

## 0.117.0

### Patch Changes

- [#581](https://github.com/valbuild/val/pull/581) [`d94a40f`](https://github.com/valbuild/val/commit/d94a40f8bd11027636d183e293aced820b6f341f) Thanks [@freekh](https://github.com/freekh)! - Images no longer show a validation warning in the editor when nothing is wrong
  with them.

  Every `s.image()` carrying width, height or a mime type used to be marked in VS
  Code with "Found image metadata, but it could not be validated", whether or not
  the metadata was correct — so the warning sat on every image in the project and
  never went away, not even after applying its own quick fix.

  That message was never a finding. `@valbuild/core` cannot read files, so it
  cannot answer whether stored dimensions match the image, and it hands the
  question on as an `image:check-metadata` fix instead. `val validate` has always
  resolved that by reading the file and comparing; the language server now does
  the same, and reports only what actually disagrees:

  ```
  Image width is incorrect! Found: 800. Expected: 944
  ```

  An image whose metadata is right gets nothing. A missing `width`, `height` or
  `mimeType` is reported, as is a stale one, with the quick fix still offered. A
  file that is not on disk is still reported as a missing file rather than as a
  metadata problem.

  The four messages involved say what they mean now, in the editor and in
  `val validate` alike:

  - "Image metadata has not been checked against the file." (was "Found image
    metadata, but it could not be validated. An image must have a width (positive
    number), a height (positive number) and a mime type." — which described a
    check that never ran)
  - "Image metadata is missing: width, height and mimeType." (was "Could not
    validate Image metadata.")
  - "File mimeType has not been checked against the file." (was "Found mimeType,
    but it could not be validated.")
  - "File metadata is missing: mimeType." (was "Missing File mimeType.")

  Also fixes an `s.file()` whose `mimeType` is missing: it reported "Mime type and
  file extension not matching. Mime type is 'undefined'" with no fix attached, so
  no quick fix was offered and the `file:add-metadata` case was unreachable. It
  now reports the missing mime type and offers to add it.

- [#579](https://github.com/valbuild/val/pull/579) [`b2812ae`](https://github.com/valbuild/val/commit/b2812ae4ee03e005ecead3365f49c625e536f94d) Thanks [@freekh](https://github.com/freekh)! - Every release now ships a changelog. Each package's `CHANGELOG.md` records what
  changed under the version that shipped it — with a link to the pull request, the
  commit and the author — and the same entry becomes the body of the GitHub
  Release for the tag. The file is included in the npm tarball, so it is also
  readable from an installed copy.

  Up to now those changelogs were generated empty, and the GitHub Releases with
  them, so there was no record of what any given version contained. Releases from
  this one on have one; earlier versions stay blank.

- Updated dependencies [[`fca3efa`](https://github.com/valbuild/val/commit/fca3efa389e2817401f55ea3dd184af7c611b807), [`d94a40f`](https://github.com/valbuild/val/commit/d94a40f8bd11027636d183e293aced820b6f341f), [`b2812ae`](https://github.com/valbuild/val/commit/b2812ae4ee03e005ecead3365f49c625e536f94d)]:
  - @valbuild/server@0.117.0
  - @valbuild/core@0.117.0
  - @valbuild/shared@0.117.0
