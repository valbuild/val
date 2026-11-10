---
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/ui": patch
---

Another editor's keystroke costs the Studio less. Locally (`pnpm dev`, and
anywhere `/stat` long-polls), the Studio no longer asks for the manifest or
the changed module after someone else types: `/stat` now carries what
`GET /manifest` would have answered, and the module's new version is computed
from the patch the Studio already fetched. Where neither can be used (an
older server, a version that does not match), the Studio asks for them as
before.
