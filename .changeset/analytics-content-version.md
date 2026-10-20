---
"@valbuild/tanstack": patch
"@valbuild/tanstack-build": patch
---

Content analytics records the content version each page was rendered from. `<ValProvider analytics>` takes a `ValAnalytics` -- `{ enabled, contentVersion? }` -- and the `val.server.ts` Val's hosting writes returns one from `fetchValAnalytics()`, with the id of the content version the platform is serving. Every beacon carries it as `cv`, so counts can be compared across a publish. The site layout passes `fetchValAnalytics()` to the provider exactly as before.
