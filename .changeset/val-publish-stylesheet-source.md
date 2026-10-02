---
"@valbuild/cli": patch
---

`val publish` no longer stores a project's stylesheets as its source. It still compiles them, so the site's CSS is unchanged, but the source a managed project's Studio builds from comes without them — as the platform's own publish has always stored it.

A stored stylesheet broke every Studio publish that followed: a browser build cannot run a Tailwind `@plugin` (the starter's `src/styles.css` has `@plugin "@tailwindcss/typography"`), so it refused the stylesheet and the publish failed with "build failed 3 times". Without one, the Studio ships the live site's CSS, which is right — a Studio edit never changes a stylesheet.
