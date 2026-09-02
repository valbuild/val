---
"@valbuild/language-server": patch
"@valbuild/core": patch
---

Images no longer show a validation warning in the editor when nothing is wrong
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
