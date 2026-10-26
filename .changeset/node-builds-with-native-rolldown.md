---
"@valbuild/tanstack-build": patch
"@valbuild/cli": patch
"@valbuild/ui": patch
---

`val publish` builds with native `rolldown` instead of rolldown's WebAssembly build. A site whose lockfile resolved `@napi-rs/wasm-runtime` 1.2.6 (released 2026-10-25) could no longer publish: `@rolldown/browser` 1.2.15 accepts that version but does not load with it, and `val publish` failed with "@valbuild/tanstack-build and rolldown … could not be loaded: Cannot set properties of undefined (setting 'initWorker')". Native `rolldown` does not use `@napi-rs/wasm-runtime` at all, so the site's version of it no longer matters. The Studio still builds in the browser with `@rolldown/browser`, from Val's own pinned versions.
