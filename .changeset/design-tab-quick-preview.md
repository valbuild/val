---
"@valbuild/shared": patch
"@valbuild/server": patch
"@valbuild/ui": patch
"@valbuild/next": patch
"@valbuild/tanstack": patch
---

The design tab no longer makes you wait.

- **Quick preview.** A change to components, layout or styles is shown in seconds, without a build: the proposal's browser code is bundled in the tab and the page in the preview runs it. What runs on the server (loaders, server functions, the page's first render) stays the last build's, and the tab says so, with a button to build. The assistant has it too (`quick_preview`).
- **Cancel and Try again.** A build can be cancelled from the tab, and a build that stops making progress for three minutes is stopped, saying at which step, so it never spins until a reload. The assistant waits for a build with `wait` instead of holding its turn, and has `build_status` and `cancel_build`.
- **Each step of a build is timed**, and the Build check lists where the time went.
- **A new build fades in where you were**, at the same page and scroll, instead of the preview going blank and starting over at the top.
- **`read_page`** lets the assistant check its change on the page: the headings, text, links, images and inputs in order, and one element's computed styles and how many lines it wraps to, at desktop, tablet or phone width.
- **Queue messages in the assistant's chat.** Write while it answers: what you write waits and is sent when the answer is done, one at a time. A queued message can be taken back to edit, moved up or removed, and Stop or a failed answer holds the queue until you go on.

The quick preview and `read_page` run in the proposal's own page, through the canvas bridge in `@valbuild/next` and `@valbuild/tanstack`, so a site needs those packages at this version for them. The quick preview is served by a service worker on the proposal's address (`/api/val/quick-preview-sw.js`), which takes code only from the site's own design tab.
