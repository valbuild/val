---
"@valbuild/ui": patch
---

Fix publish being blocked by keyOf/route validation fixes that are resolved at read time. The manual and fs-mode auto-publish gates now consult the resolved/partitioned validation errors (the same set the UI surfaces) instead of the raw worker output, which always contains `keyof:check-keys`/`router:check-route` placeholders.
