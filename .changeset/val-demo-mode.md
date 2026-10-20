---
"@valbuild/server": minor
"@valbuild/shared": minor
"@valbuild/tanstack": minor
"@valbuild/ui": minor
---

Demo mode: run the Val Studio with no account and no backend (TanStack Start).

`<ValApp demo>` starts Val's own server in the visitor's browser tab, and the Studio talks to it there instead of to `/api/val`. Edits show up in the page as they are typed and are held in the tab's memory: nothing is sent anywhere, and a reload starts over. Images and videos can be uploaded too: a small service worker, served by `initValDemoServer()`, hands the upload and the unpublished files to the server in the tab, so an uploaded photo or video shows in the page with nothing leaving the browser. Uploads are capped by their size after encoding. Pair `<ValApp demo>` with `<ValProvider demo>` on the site and `initValDemoServer()` from the new `@valbuild/tanstack/demo` entry on the API route. In a demo the Studio opens with a guided tour, Publish explains what it would do instead of publishing, and Preview in a new tab is shown but disabled.

Also:

- `@valbuild/server/browser` is a new entry: Val's request handling, bundleable for a browser. The TypeScript compiler, which only publishing and history need, is loaded when they ask for it, so a browser bundle of the server is about 140 KB rather than 3.6 MB.
- `s.image({ encode })` now scales an image down in browsers that cannot write WebP (Safari), as a JPEG or PNG in the image's own format, instead of uploading it at full size.
- `GET /profiles` answers with no profiles, rather than an error, when edits are stored locally and no project is configured.
