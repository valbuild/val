---
"@valbuild/ui": minor
"@valbuild/server": patch
"@valbuild/shared": patch
---

**Check everything** on the Studio's Validate page now checks remote images and
files too.

- A remote image or file whose address no longer matches what is recorded about
  it (its size, type or the schema's options changed since it was uploaded) has
  a **Fix**, which re-reads the file and corrects it, as `val validate --fix`
  does.
- A remote host that does not answer is shown once, at the top of the page, with
  how many files it holds and a **Try again**, rather than as an error on every
  image.
- A file its host no longer has is shown at the image or file that uses it.

Images and files in your unpublished changes are not asked about until they are
published; the check makes sure the change still has them.
