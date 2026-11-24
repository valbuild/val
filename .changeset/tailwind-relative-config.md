---
"@valbuild/tanstack-build": patch
"@valbuild/cli": patch
---

**`val publish` now finds a Tailwind `@config` or `@plugin` written relative to the stylesheet.** `@config "../tailwind.config.js"` in `src/styles.css`, which `vite build` reads, stopped `val publish` with "could not be resolved from the project": the path was resolved from the project root instead of from the stylesheet. It is now resolved from the stylesheet that has the directive, and a path that names no file says which file it looked for.

`val publish` also prints what the site build warned about, which it used to drop: a CSS module's `composes:` or `:global()`, which are not supported, an `@import` of a file that is not there, and an ignored `@source`.
