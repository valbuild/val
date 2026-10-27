---
"@valbuild/core": patch
"@valbuild/tanstack": patch
---

A TanStack splat route now has a page of its own. `src/routes/docs.$.tsx` serves `/docs` as well as everything under it, the way TanStack Router matches it, and `/docs` is now a valid key in its Val module. It used to be refused ("does not match `/docs/[..._splat]`"), so the page TanStack served at `/docs` could not be given content. `useValRoute` on that page reads the `/docs` entry.
