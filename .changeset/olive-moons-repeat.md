---
"@valbuild/shared": patch
"@valbuild/ui": patch
---

The Studio can run a whole publish: read what to build and what to build it from, build it, and hand the result to the content service.

The two reads go through the same proxy and the same credential as the publish conversation, and both are validated rather than cast — an error page from a gateway in between would otherwise fail several layers down inside the bundler with a message about a module specifier.

Generating a route tree for a file-based project is a capability the deployment supplies, like `routeSplitter` and `loadCssModule` already are. Without one, such a project is refused by name rather than failing with `UNRESOLVED_ENTRY`.
