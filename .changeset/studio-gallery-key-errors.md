---
"@valbuild/shared": patch
"@valbuild/ui": patch
---

Val Studio now shows errors in a gallery's keys, and does not publish them. A remote URL in an `s.imageset()`, `s.fileset()` or `s.videoset()` that is not `.remote()`, a remote URL that is not valid, or one outside the gallery's `dir` was hidden in the Studio and did not stop a publish, because it was treated as something saving would repair. Nothing repairs it, so the entry's tile is now marked with the error and publishing waits until it is fixed. `npx val validate` already reports these errors.
