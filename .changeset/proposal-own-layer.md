---
"@valbuild/ui": patch
"@valbuild/server": patch
---

A proposal that changes the project's dependencies is built against a layer of its own. When a proposal stages a new `package.json` and lockfile, the platform builds a dependency layer for them, and Build in that proposal now uses it instead of the site's. While the layer is being built, or when it could not be, Build says so instead of building against dependencies the proposal no longer has. Proposals that change no dependencies build exactly as before.
