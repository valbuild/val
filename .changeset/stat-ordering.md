---
"@valbuild/ui": patch
"@valbuild/server": patch
"@valbuild/shared": patch
---

A save is no longer refused once because an older answer from the server arrived after a newer one. The content service now reports a version of its list of changes, which goes up with every save, discard and publish. The Studio ignores any answer older than one it already has, including the answer to its own last save, discard or publish, so a discarded change can no longer briefly come back, and a published one can no longer briefly show as unpublished.
