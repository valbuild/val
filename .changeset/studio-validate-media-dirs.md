---
"@valbuild/ui": minor
"@valbuild/server": patch
"@valbuild/shared": patch
---

**Check everything** on the Studio's Validate page now checks media directories
(`s.imagedir()`, `s.filedir()`, `s.fontdir()` and `s.videodir()`) by the files
they list:

- An entry whose file is gone has a **Fix** that removes it from the directory.
- An image or file entry whose recorded size or type does not match its file has
  a **Fix** that corrects it from the file, keeping its alt text.
- A video entry whose file is gone is reported, and is removed by hand: its
  posters and captions may still be in use.
- A remote entry is checked with its host, like any remote file.

`val validate --fix` fixes media directories exactly as before.
