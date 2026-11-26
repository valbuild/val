---
"@valbuild/tanstack": patch
"@valbuild/shared": patch
---

A quick preview no longer fails every page check with React's hydration error (React error 418)

In code mode, a change is first shown as a quick preview: the page the last build's server rendered, run by the proposal's new code. The new code used to _hydrate_ that page after the old markup had been taken out, and React reported the empty page as a hydration failure on every quick preview. The page check read it as the site's own error, and asked the assistant to fix something that was never there.

Now `ValProvider` has the new code _render_ the site on a quick preview's page instead, as the page is hydrated, so there is nothing to fail. The last build's page stays on screen until the new one replaces it, rather than the page going empty first. Every other page, for every visitor, is hydrated exactly as before, and a real hydration bug is still reported.

Nothing changes in your project. It takes effect once the site's build is on this version: the quick preview starts from that build's page.
