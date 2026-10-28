---
"@valbuild/ui": patch
---

The demo no longer offers "Check everything" on the Validate page, which always stopped at the first file there ("Checking everything needs the project's files and Val's file hosts, and this Studio runs without them"). The demo's server runs in the browser tab without the project's files, so the page shows the Studio's own errors and says why the full check is not there, and the top bar shows Validate only while there are errors to show.
