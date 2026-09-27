---
"@valbuild/ui": patch
"@valbuild/server": patch
"@valbuild/shared": patch
---

A save is no longer refused once because an older answer from the server arrived after a newer one. The content service now reports a version of its list of changes, which goes up with every save and every discard, and the Studio ignores any answer older than one it already has, including the answer to its own last save.
