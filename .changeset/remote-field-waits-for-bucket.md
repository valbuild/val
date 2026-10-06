---
"@valbuild/ui": patch
---

A remote image, file or video field no longer uploads a file as local when it is picked right after the Studio opens. The field stays disabled until the Studio has chosen a remote bucket, as remote galleries already did. Before that, a file picked in that moment was given a local path and uploaded as a local file, even though the field was remote.
