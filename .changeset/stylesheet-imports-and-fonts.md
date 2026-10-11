---
"@valbuild/tanstack-build": patch
"@valbuild/cli": patch
---

Publishing to Val's platform, through `val publish` or the Studio, now handles a stylesheet that imports other stylesheets, and fonts installed as packages:

```css
/* src/styles.css */
@import "tailwindcss";
@import "./theme/theme.css";

/* src/theme/theme.css */
@import "@fontsource-variable/inter";
```

Before this, the platform's build passed `@import "./theme/theme.css"` on to Tailwind without resolving it, and publishing stopped with `Tailwind asked for './theme/theme.css', which this build does not carry`. A font package such as `@fontsource-variable/inter` was built as code, failed, and was skipped.

- A stylesheet's own `@import`s are inlined where they were written, the same way `vite build` handles them. That covers relative files and stylesheets that dependencies ship. `layer()`, `supports()` and media conditions are kept, and a stylesheet imported twice is only included once.
- The files a dependency's stylesheet points at with `url(...)`, such as a font package's `.woff2` files, are published with the site and served from it.
