---
"@valbuild/ui": patch
---

The Studio opens pages whose route has an optional segment, such as TanStack Start's `{-$locale}`. A browser percent-encodes `{` and `}` in an address, and the Studio read the module path back without decoding it, so every page of a site with its language in the URL showed "This page can no longer be found", including pages the Studio had just linked to.
