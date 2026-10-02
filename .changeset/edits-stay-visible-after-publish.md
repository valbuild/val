---
"@valbuild/server": patch
"@valbuild/tanstack": patch
"@valbuild/tanstack-build": patch
---

Edits no longer disappear from a site on Val Build for up to a minute after its first publish.

For a short while after a publish, the site can still serve the previous build. If that build was the project's starting template, it was treated as though it already had the new changes, so they vanished from the page until the new build reached you. Each build now tells Val's content service which build it is, and gets exactly the changes it is missing.
