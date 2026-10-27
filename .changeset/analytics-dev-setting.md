---
"@valbuild/tanstack": patch
---

Content analytics can be turned on while developing: `VAL_ANALYTICS=true` in the app's `.env.development` turns it on under `vite dev` for a `<ValProvider>` that is passed no `analytics`, so the leak warning shows you where an edit tag leaves React before any visitor gets it. It is read only on the development server; a hosted site is still switched on in its project settings.

The "Val is currently hidden" note in the browser console now shows in development with TanStack Start. It looked for `process.env.NODE_ENV`, which the development server does not set in the browser.
