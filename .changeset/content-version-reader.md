---
"@valbuild/server": patch
"@valbuild/tanstack": patch
"@valbuild/tanstack-build": patch
---

A site served by Val's platform can now be given its content separately from its build. When the platform hands a TanStack app a content version (`VAL_CONTENT`) that differs from what the build bundles, Val renders that content, in the Studio and in draft mode too. It reads it the way it already reads a proposal's saved content.

Nothing changes for an app that is not given one, and nothing hands one over yet. This is the reading side of publishing content without rebuilding the site.
