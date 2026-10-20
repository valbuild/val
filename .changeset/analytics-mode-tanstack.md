---
"@valbuild/tanstack": patch
"@valbuild/tanstack-build": patch
---

TanStack Start: a new analytics mode, the first step towards content analytics. It is off by default. With `<ValProvider analytics>`, content read with the hooks (`useVal`, `useValRoute`, `useValKey`) is tagged for every visitor, not only in draft mode, so each element showing content carries a `data-val-path`. The tags are added in the browser after hydration, so the HTML the server sends is unchanged and a crawler that does not run the page never sees them.

On a site hosted by Val, analytics is a project setting: the owner turns it on in the project's settings, and the `val.server.ts` the platform writes now exports `fetchValAnalytics()` to read it. Pass it to the provider from the site layout's loader, beside `fetchValDraft()`; see the README.
