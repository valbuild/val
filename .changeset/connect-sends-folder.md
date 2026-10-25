---
"@valbuild/cli": patch
---

`val connect` in a monorepo now tells Val which app you ran it in. The link it opens names the app's folder in the repository (`folder=apps/web`), so the new-project page picks that app's `val.config.ts` instead of asking you to choose.
