---
"@valbuild/ui": minor
"@valbuild/server": minor
"@valbuild/shared": minor
---

The project name in the Studio's top bar is now a project switcher, for projects connected to Val Build. It shows the project you are in, the projects you pinned and the five you opened most recently, and searches every project in your organisations. Choosing one opens its Studio.

The switcher is served by Val Build (`admin.val.build/wc/v1/project-switcher.js`), so it can improve without a Val release. Until it loads — or if it cannot, for example offline or under a strict Content Security Policy — the Studio shows the project name and its link exactly as before. If your app sets a CSP, allow `script-src https://admin.val.build` to get the switcher.

It reaches Val Build through a new route on your app's Val server, `/api/val/admin/proxy/*`, which adds the editor's existing Val Build session. That route forwards only to Val Build's Studio API, only with the `x-val-studio` header that a cross-site request cannot send, and answers `not-connected` in local (fs) mode, where the Studio keeps its plain project name.
