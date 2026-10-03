---
"@valbuild/ui": patch
---

The publishing percentage no longer falls back after the upload. A publish built in the Studio tab used to climb to about 60%, drop to 8% while the tab handed the build over, and then jump to 64%. It now goes straight from the upload to the site check.
