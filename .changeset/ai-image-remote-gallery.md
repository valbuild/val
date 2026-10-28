---
"@valbuild/ui": patch
---

An image the assistant adds to a remote gallery (`s.imagedir(...).remote()`, which is every gallery in a hosted project) now shows up. The entry used to be saved under a plain `/public/...` path while its bytes were stored as a remote file, so the Studio looked for a local file that did not exist and showed a broken image, and a published site would have named a file nothing serves. The entry is now saved under a remote ref, the same as an image uploaded with the gallery's own Upload button.
