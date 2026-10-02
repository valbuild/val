---
"@valbuild/ui": minor
"@valbuild/server": minor
"@valbuild/shared": minor
---

The project name in the Studio's top bar is now a project switcher, for projects connected to Val Build. It shows the project you are in, the projects you pinned and the five you opened most recently, and searches every project in your organisations. Choosing one opens its Studio.

The top bar also gets a **Share** button (an icon on a phone). It shows who is in the project's organisation. Owners can create invite links for a role (each works once and expires after 7 days), see and revoke pending links, and change members' roles. Everyone else can see the members and which owners to ask.

Both are served by Val Build (`admin.val.build/wc/v1/project-switcher.js` and `members.js`), so they can improve without a Val release. Until they load — or if they cannot, for example offline or under a strict Content Security Policy — the Studio shows the project name and its link exactly as before, and Share is a link to the members page in Val Build. If your app sets a CSP, allow `script-src https://admin.val.build` to get them.

They reach Val Build through a new route on your app's Val server, `/api/val/admin/proxy/*`, which adds the editor's existing Val Build session. That route forwards only to Val Build's Studio API, and only with the `x-val-studio` header that a cross-site request cannot send.

In local development both appear once you have run `val login`, and use that login. Without one the Studio keeps the plain project name, as before; it does not load them just to say you are not logged in.
