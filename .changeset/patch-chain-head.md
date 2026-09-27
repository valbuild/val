---
"@valbuild/ui": patch
"@valbuild/server": patch
"@valbuild/shared": patch
"@valbuild/mcp": patch
---

Saving no longer gets stuck on "Changes cannot be saved: something else keeps changing them first" when another editor has an unpublished change and later work has been published.

A new change is now written on top of the latest change the content service has registered, which it reports alongside the list of pending changes, instead of the last change this deployment was shown. Since changes can be published independently, those two can differ for good: an unpublished change can sit before published ones that the running deployment already contains. The Studio and the MCP tools both name the reported head, and fall back to the old behaviour against a content service that does not report one.
