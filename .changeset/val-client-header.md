---
"@valbuild/server": patch
"@valbuild/cli": patch
"@valbuild/shared": patch
---

Requests that `@valbuild/server` and the `val` CLI send to Val Build now carry an `x-val-client` header naming the package and its version, for example `x-val-client: @valbuild/server@0.150.24`. It lets Val Build see which versions are still in use, and which old endpoints they still call, before anything is retired. The header holds no credential and nothing about your site's visitors, and nothing changes in how your app behaves.
