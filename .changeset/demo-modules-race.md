---
"@valbuild/tanstack": patch
---

`<ValApp demo>` no longer says "This demo was built without its content" now and again, on a build that has its content. The demo started Val's server before `<ValModulesClient>` had registered the modules, and on a page that had the server's code already it read them before they were there. It now starts once `ValApp`'s children are rendered.
