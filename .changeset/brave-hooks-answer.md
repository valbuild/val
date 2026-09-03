---
"@valbuild/ui": patch
---

Fix `useCurrentAuthorId` throwing outside a `ValProvider`, which broke every render of the review screen in isolation.
