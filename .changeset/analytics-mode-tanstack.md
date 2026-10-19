---
"@valbuild/core": patch
"@valbuild/shared": patch
"@valbuild/server": patch
"@valbuild/tanstack": patch
---

TanStack Start: a new analytics mode, the first step towards content analytics. With `analytics: { enabled: true }` in `val.config.ts`, or `<ValProvider analytics>` to decide at runtime, content read with the hooks (`useVal`, `useValRoute`, `useValKey`) is tagged for every visitor, not only in draft mode, so each element showing content carries a `data-val-path`. The tags are added in the browser after hydration, so the HTML the server sends is unchanged and a crawler that does not run the page never sees them. Nothing is counted or sent yet; the script that counts what visitors see comes next.
