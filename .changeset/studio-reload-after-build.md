---
"@valbuild/ui": patch
---

**A Studio open while its proposal is built is told to reload.** Once a build is served, the page in the preview is the new build straight away, while the Studio was still running the old one's modules. Picking a field the new code added then failed. The Studio now asks its server which schema it runs whenever the preview's page loads, so a newer build says "reload" before you pick anything.

**The design tab's assistant builds only when it has to.** `build_proposal` now takes a reason: a route added, removed or renamed; code that runs on the server; a `.val.ts` schema; dependencies; or the whole request being finished. In the design tab it won't start without one. The quick preview shows changes to components, layout, styles, text and content without a build, and the assistant is no longer told to build after each step.
