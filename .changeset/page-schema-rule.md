---
"@valbuild/react": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
"@valbuild/shared": patch
"@valbuild/ui": patch
"@valbuild/server": patch
---

A page no longer shows content made for code it does not have yet. When the Studio is ahead of the page (it picked up a code change first, or the browser is still running the previous build), the page keeps showing its own content for the modules whose schema changed, and says "The code changed" with a **Reload** button — in the overlay on your site, and above the page in the Studio. In local development the page usually catches up a moment later by itself, and the notice goes away without a reload.
