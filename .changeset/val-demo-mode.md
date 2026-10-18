---
"@valbuild/server": minor
"@valbuild/shared": minor
"@valbuild/tanstack": minor
"@valbuild/ui": minor
---

Demo mode: run the Val Studio with no account and no backend (TanStack Start).

`<ValApp demo>` starts Val's own server in the visitor's browser tab, and the Studio talks to it there instead of to `/api/val`. Edits show up in the page as they are typed and are kept for the life of the tab; nothing is sent anywhere. Pair it with `<ValProvider demo>` on the site and `initValDemoServer()` from the new `@valbuild/tanstack/demo` entry on the API route, which serves the Studio's own files and nothing else. In a demo the Studio opens with a guided tour, Publish explains what it would do instead of publishing, and uploads are off. See `examples/demo` for a complete app.

Also:

- `@valbuild/server/browser` is a new entry: Val's request handling, bundleable for a browser.
- `GET /profiles` answers with no profiles, rather than an error, when edits are stored locally and no project is configured.
