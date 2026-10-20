---
"@valbuild/server": patch
---

Demo mode (`<ValApp demo>`) now starts under `vite dev`. It used to stop at
"The demo could not start: part of it did not load", with
`does not provide an export named 'Buffer'` in the console, because the server
that runs in the tab imported the CommonJS `buffer` package, and Vite's dev
server does not convert a dependency it only meets in a chunk loaded on demand.
That server now handles bytes without `buffer`, so an app needs no Vite
configuration for it, and `@valbuild/server` no longer depends on the package.
If you added `buffer` to `optimizeDeps.include` to work around this, you can
remove it.
