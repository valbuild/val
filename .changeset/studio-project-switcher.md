---
"@valbuild/ui": minor
"@valbuild/server": minor
"@valbuild/shared": minor
---

The project name in the Studio's top bar is now a project switcher, for projects connected to Val Build. It shows the project you are in, the projects you pinned and the five you opened most recently, and searches every project in your organisations. Choosing one opens its Studio.

The top bar also gets a **Share** button (an icon on a phone). It shows who is in the project's organisation. Owners can create invite links for a role (each works once and expires after 7 days), see and revoke pending links, and change members' roles. Everyone else can see the members and which owners to ask.

The assistant can be set up from the Studio too. Settings › Assistant shows the AI key this project runs on and whether it works. From there you can add a key, update it, remove it, or choose one that already exists: the organisation's, your own, or another project's. The assistant's empty state offers the same when no key is set up. Every key is checked with the provider before it is saved, and once a key is saved the assistant turns on without a reload.

The panels are served by Val's content server (`content.val.build/wc/v1/project-switcher.js`, `members.js` and `ai-setup.js`), beside the API they read and write, so they can improve without a Val release. The Studio draws the project name and the Share button itself, and loads the switcher and Share panels only when the button is first hovered or clicked, so opening the Studio fetches nothing extra. If a panel cannot load, for example offline or under a strict Content Security Policy, the click opens the same page in Val Build instead, and the AI setup is a link to the project's AI keys there. If your app sets a CSP, allow `script-src https://content.val.build` to get them.

They reach Val Build through a new route on your app's Val server, `/api/val/admin/proxy/*`, which adds the editor's existing Val Build session. That route forwards only to the Studio API on Val's content server (`/v1/studio/*` on `VAL_CONTENT_URL`, `https://content.val.build` by default), and only with the `x-val-studio` header that a cross-site request cannot send.

In local development they appear once you have run `val login`, and use that login. Without one the Studio keeps the plain project name, as before; it does not load them just to say you are not logged in.
