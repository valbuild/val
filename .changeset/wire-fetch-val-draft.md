---
"@valbuild/tanstack-build": patch
---

A project made from the TanStack starter builds on Val Build again. Since the starter started reading the page's draft (`fetchValDraft`, so a draft page is rendered as the draft from the first paint), its `src/val/val.server.ts` exports one more reader, and the `val.server.ts` that Val Build writes in its place did not, so the build failed with `"fetchValDraft" is not exported by "src/val/val.server.ts"`. The written file now exports it. With an `@valbuild/tanstack` older than 0.140.0 it returns no draft, which is how those versions render anyway.
