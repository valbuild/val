---
"@valbuild/ui": patch
---

Fix the Studio failing to load on 0.108.0 with `Failed to load module script: Expected a JavaScript-or-Wasm module script but the server responded with a MIME type of ""`.

`@valbuild/ui` substitutes the package version into its bundled server after Vite has run, by replacing a `$$BUILD_$$…$$` placeholder in the emitted JavaScript. Vite 8 (rolldown/oxc) constant-folds the app path into a single template literal and escapes every `$` while printing it, so the plain string replace no longer found it and the placeholder shipped. `/api/val/static/<version>/app` then matched nothing and fell through to the SPA fallback, which returned the index HTML — with an empty `Content-Type` — where the browser expected the app bundle.

The substitution now tolerates however the bundler prints the placeholder, the build fails if any placeholder survives, and a new post-build step loads the packaged server bundle and asserts that `/<version>/app` is served as `application/javascript`. The SPA fallback also declares `text/html` instead of an empty content type.
