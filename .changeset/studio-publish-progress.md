---
"@valbuild/ui": patch
---

A publish built in the Studio now shows which step it is on and how long it has run, in the status bar: loading the builder, building, uploading *n of m*, checking the site renders, going live. After it goes live, the Studio waits until the site, as your browser reaches it, actually serves the new build. Only then does it say "Live after 42s". A Cloudflare location can serve the previous build for up to a minute after a publish, and that minute used to look like a publish that had not worked.

Each publish also logs its steps and their durations to the browser console (`Val: publish live in 42.1s -- building 6.2s, verifying 18.0s, …`), so a slow publish can be reported with the step that was slow.
