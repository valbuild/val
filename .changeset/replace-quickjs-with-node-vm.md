---
"@valbuild/server": patch
"@valbuild/cli": patch
---

Val modules are now loaded with Node's `vm` module instead of QuickJS. `@valbuild/server` no longer depends on `quickjs-emscripten`; the new `loadValModules` evaluates the project's `val.modules` and the local `*.val.ts` files it imports, resolving `@valbuild/*` through the real Node resolver so user modules share the exact same `@valbuild/core` instance as `extractValModules`.

Two consequences worth knowing:

- **Only modules registered in `val.modules` are validated.** `val validate` and `val list-unused-files` skip `*.val.ts` files found on disk that are not in the registry (a warning is printed for each). This is inherent to loading through the registry — reusable schema fragments were previously validated on their own, and no longer are.
- **The `vm` context is not a security sandbox.** It deliberately exposes `process` and a `require` that falls back to the real Node resolver. `loadValModules` runs from the CLI against the project's own first-party files, i.e. the same trust level as running the project's build, and must never be used to evaluate untrusted modules.

`createService` no longer takes a `ServiceOptions` argument — its `disableCache` option only applied to the removed QuickJS transpilation cache. The signature is now `createService(projectRoot, host?)` and the `ServiceOptions` type is no longer exported.
