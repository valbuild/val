---
"@valbuild/language-server": patch
---

**"Upload this gallery's images to Val Remote" uploads the whole gallery.** The quick fix in the editor uploaded only the image it was offered on, although its title promised the gallery, and the image moved to the end of the gallery. It now uploads every image in that gallery that still has a local path, one after another, in the order the gallery lists them, so they keep their places. The gallery and every field that shows one of its images are rewritten in a single edit, which one undo takes back. If an upload fails partway, what was uploaded is still written, and running the fix again uploads the rest. The same goes for "upload this gallery's files".
