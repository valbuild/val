---
"@valbuild/server": patch
---

A Val configuration error no longer crashes the dev server. The `ValServer` is created at module-eval time but only awaited per request, so a rejection (for example proxy mode without a `project`) previously surfaced as an `unhandledRejection` and terminated the Node process. It is now reported as a `500` response with the underlying message on every request instead, so `next dev` and hot reload keep working while you fix the config.
