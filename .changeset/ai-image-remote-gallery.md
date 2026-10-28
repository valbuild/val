---
"@valbuild/ui": patch
"@valbuild/shared": patch
"@valbuild/server": patch
---

Images the assistant adds now show up in remote storage, which is where every image in a hosted project lives: in a remote gallery (`s.imagedir(...).remote()`), in a remote image field (`s.image().remote()`) and inline in rich text whose images are remote. They used to be saved under a plain `/public/...` path while their bytes were stored as a remote file, so the Studio looked for a local file that did not exist and showed a broken image, and a published site would have named a file nothing serves. They are now saved under a remote ref, the same as an image uploaded with the Studio's own Upload button.

The image is still moved from the chat to the change rather than copied: the content service points the change at the image it already holds, and nothing is downloaded or uploaded again. The content service now says what the image's bytes hash to, which is what a remote ref is named by; against one that does not yet, the Studio downloads the image once to hash it.

The assistant can also now put an image into an empty rich text by writing the whole value; that used to be refused.
