---
"@valbuild/ui": patch
"@valbuild/server": patch
"@valbuild/tanstack": patch
"@valbuild/tanstack-build": patch
---

Changes that are already published no longer briefly vanish from the Studio, or show up twice, right after a publish in app mode.

A build the Studio makes in the browser now records which publish it was made for, so Val knows exactly which changes the running site already has. Before this, Val worked that out from whichever build was live, and was wrong for a moment while a publish was going live. A reload in that moment could hide changes that were not on the site yet, or apply ones that were a second time. Projects set up before this release need no changes.
