---
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
"@valbuild/ui": patch
---

**What the design tab needed is removed with it.** The page's canvas bridge
now answers `read_page`, `screenshot_page` and a quick preview only to the
Studio at the page's own origin, and no longer asks the server whether another
origin is the site's design tab. The site's server no longer writes a
proposal's files or offers the `patch-file` route: code and content are
changed in the proposal's own Studio. The assistant's `build_proposal` no
longer takes a `reason`.
