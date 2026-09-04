# @valbuild/core

## 0.120.0

### Minor Changes

- [#589](https://github.com/valbuild/val/pull/589) [`c2d3c0e`](https://github.com/valbuild/val/commit/c2d3c0e6c2010c0a94c725d9dbaa618998773e8a) Thanks [@freekh](https://github.com/freekh)! - **Breaking:** `s.richtext()` options are flat.

  The `style`, `block` and `inline` groups are gone — every option is a key of its
  own. The names are unchanged, so updating a schema is only a matter of removing
  the wrappers:

  ```ts
  // before
  s.richtext({
    style: { bold: true, italic: true },
    block: { h1: true, ul: true },
    inline: { a: true, img: s.image() },
  });

  // after
  s.richtext({
    bold: true,
    italic: true,
    h1: true,
    ul: true,
    a: true,
    img: s.image(),
  });
  ```

  The groups never carried any meaning the option names did not already have, and
  they cost something real: an option name and its `ValRichText` theme key were
  spelled differently (`block.h1` vs `theme.h1`), so the type that keeps a theme
  exhaustive had to restate all thirteen options by hand. It is now a mapped type
  over the options themselves — which also fixes an inconsistency in it: enabling
  links with a schema (`a: s.route()`) rather than `a: true` now requires an `a`
  key in the theme, the way `img` always has.

  `ValRichText` themes were already flat and are unchanged. The serialized schema
  that the server sends the Studio is flat too, so a project must not mix
  `@valbuild/*` versions across this release.

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
