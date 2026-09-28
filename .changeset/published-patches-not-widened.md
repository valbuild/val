---
"@valbuild/ui": patch
---

The first edit after a publish no longer says "1 change was added to your changes".

A published patch stays in the list of changes until the deploy lands. The Studio took it for an earlier edit that yours depended on, sent it along with your save, and showed the toast. Published patches are now treated as already shipped, which is how the publish check already treats them.
