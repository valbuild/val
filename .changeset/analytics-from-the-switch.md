---
"@valbuild/tanstack": patch
---

Content analytics now works with nothing in the code: switching it on in a hosted project's settings is enough. With no `analytics` prop, `<ValProvider>` reads the setting itself -- the server render reads the `VAL_ANALYTICS` value Val's hosting hands the site, with the content version, and writes it into the page as a few bytes of JSON (`<script id="__val_analytics">`), which the browser reads back. Nothing is written while it is off.

A layout that passes `analytics={...}` from `fetchValAnalytics()` keeps working, and what it passes wins. The browser never reads `VAL_ANALYTICS` from the environment, so it needs no `VITE_` prefix and a build never fixes it: switching it off stops the counting without a rebuild.
