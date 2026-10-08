# @valbuild/ui

## 0.142.0

### Minor Changes

- [#806](https://github.com/valbuild/val/pull/806) [`f14e0aa`](https://github.com/valbuild/val/commit/f14e0aabedba07b832b1453d49635af5d2fbc019) Thanks [@freekh](https://github.com/freekh)! - New: a **Members** button in the Studio's top bar, beside Share, for projects connected to Val Build.

  It lists who can open the project: the organization's owners, and the people chosen for it. Owners and developers can add someone from the organization or remove them, and owners see what each seat costs. "Invite to {org}" in the same panel brings in someone new. Share still lists the organization's members and invites.

  An invite created from a Studio's Share panel now also lets the person open that project. Before, they only joined the organization, which no longer opens its projects.

- [#812](https://github.com/valbuild/val/pull/812) [`521fe94`](https://github.com/valbuild/val/commit/521fe9400c0b660aa5b3642942cd0cc26622f193) Thanks [@freekh](https://github.com/freekh)! - New: when a project's organization on Val Build is read-only, the Studio says so above the editor before anyone starts typing. An organization becomes read-only when its trial has ended, or when a payment failed and the grace period has run out.

  The site keeps running, but nothing can be saved or published until the plan is fixed. An owner gets a button to Billing (**Start Pro** or **Update payment**). Everyone else sees who the owners are and gets a button to email them.

### Patch Changes

- [#814](https://github.com/valbuild/val/pull/814) [`1671bce`](https://github.com/valbuild/val/commit/1671bce6f0b65dac77e51655f24ef825f4671ebb) Thanks [@freekh](https://github.com/freekh)! - Publishing from an iPhone no longer gets stuck on "Starting the publish".

  On a phone, Publish opens a builder tab to build the site, and iOS pauses the page you pressed Publish on as soon as that tab opens. That page used to be the one that started the publish, so the builder tab could wait for it indefinitely. It happened most often when you pressed Publish right after making a change, while that change was still being saved. The builder tab now starts the publish itself, waits for your last change to be saved first, and the page you came from picks it up when you go back to it. "Try again" on a failed publish and "Update site" work the same way.

  If something does go wrong, the builder tab now says what happened and what to do instead of spinning: a publish that could not reach Val is retried, and one that cannot go ahead says why.

  Reloading the builder tab, going back to it or opening its link again now shows how that publish went instead of starting it again.

- [#805](https://github.com/valbuild/val/pull/805) [`bb63738`](https://github.com/valbuild/val/commit/bb63738aabed1cf1287611ecaab7c35fc4b08a12) Thanks [@freekh](https://github.com/freekh)! - Publish in a proposal: merging it into the site. The dialog shows whether it can go now, and names who to ask when it cannot; Publish saves anything unsaved, builds the site with the proposal in this tab, and content checks it renders and makes it live as one change. A merged proposal is finished: its Studio says so above the editor, and anything written in it while it merged is moved to a new proposal, which the Studio offers to open. Review in a proposal now compares it with the site, saved and unsaved changes alike.

- [#805](https://github.com/valbuild/val/pull/805) [`3d2b9e8`](https://github.com/valbuild/val/commit/3d2b9e8c11aa6a4449527e2a1bbb363566797a14) Thanks [@freekh](https://github.com/freekh)! - Proposals in the Studio, for projects on the Val platform that have them turned on: a switcher in the top bar to move between the site and its proposals, New proposal, Rename, Close and All proposals (with Reopen), and — inside a proposal — Save where Publish is, in the proposal's colour. Nothing is shown for a project without proposals. At a proposal's address the server now refuses to publish to the site, so a Save there can never start a site build.

- [#815](https://github.com/valbuild/val/pull/815) [`a3236a5`](https://github.com/valbuild/val/commit/a3236a5f2c41b92422b40340dba060b53218c6ab) Thanks [@freekh](https://github.com/freekh)! - Fixed: a project that is not connected to Val Build yet (no `project` in `val.config`) no longer gets errors from the Studio on every page load. The Studio used to ask for the assistant, its conversations and the project's members anyway, and got `401` and `500` answers that showed up in the browser console and as an issue badge in the Next.js dev overlay. It now asks only once there is a project to ask about, and the assistant is hidden until there is. The chat used to say "Login to use AI chat" in that state, which no login could fix.

  A project named only in the `VAL_PROJECT` environment variable counts as connected, as it always did on the server.

## 0.141.1

### Patch Changes

- [#809](https://github.com/valbuild/val/pull/809) [`6faacda`](https://github.com/valbuild/val/commit/6faacda398fc92bec187b7afe07a53228a6f2a3b) Thanks [@freekh](https://github.com/freekh)! - After a publish fails, the Studio no longer looks as though it is still publishing.

  - The status bar shows "Not published" as soon as your publish fails. It used to show "Reaching visitors" for up to a minute when the publish before it had gone live less than a minute earlier.
  - The Publish button is offered again for the changes that did not go out. It used to read "Publishing" beside the "Could not publish" message until the Studio next heard from the content service, which could take up to twenty minutes.

- [#808](https://github.com/valbuild/val/pull/808) [`14b18d7`](https://github.com/valbuild/val/commit/14b18d7cb145cec1bc1cd832b9ca857ff4b45adc) Thanks [@freekh](https://github.com/freekh)! - A project with `files: { remote: true }` can save text edits without remote-file credentials: in local development without `val login` or a project id, and on a server without `VAL_API_KEY`.

  Before, a save asked for remote credentials whenever any schema in the project was remote. With `files: { remote: true }` that is every media schema, so every save was refused, even a typo fix. Now it asks only when the change being saved contains a remote file.

  When uploads are unavailable, the Studio now shows a card above the editor. It says what is wrong and gives the fix: a link to admin.val.build or the `val login` command to copy. When the cause is missing setup (no project id, not logged in, no API key) it also says that text edits still save and publish. Dismissing it leaves an "Uploads off" item in the status bar, or in the account sheet on a phone, that brings it back. This replaces the red bar that covered the top of the Studio, the Publish button included, and the login dialog that opened on every load.

## 0.141.0

### Minor Changes

- [#802](https://github.com/valbuild/val/pull/802) [`199e214`](https://github.com/valbuild/val/commit/199e21471d98806fb34c579cb876560078c928b9) Thanks [@freekh](https://github.com/freekh)! - New: `files: { remote: true }` in `val.config.ts` stores every image, file and video on Val's remote content host.

  ```ts
  const { s, c, val, config } = initVal({
    project: "myorg/myproject",
    files: { remote: true },
  });
  ```

  With it, `s.image()`, `s.file()`, `s.video()`, `s.imageset()`, `s.fileset()`, `s.videoset()` and `s.richtext({ img: true })` behave as though `.remote()` had been written on them. Images already in the project are reported as `image:upload-remote` until they are uploaded; `npx val validate --fix` does that.

  **Required in the Val app.** A project running there (`VAL_ENV=app`) refuses to start without it, with an error that says what to add, and `val publish` refuses before it builds.

  **Breaking:** `files.directory` has been removed from `val.config.ts`. Local files that have no `dir` of their own are stored in `/public/val`, which was the default.

- [#779](https://github.com/valbuild/val/pull/779) [`ba3f330`](https://github.com/valbuild/val/commit/ba3f3300a3dd8649e154097cdfca3b64db209d89) Thanks [@freekh](https://github.com/freekh)! - New: `s.video()`, for mp4/WebM files and HLS streams.

  ```ts
  const schema = s.object({
    intro: s.video({ stream: { type: "hls" } }),
  });
  ```

  - **Upload and play in the Studio.** A video field shows a player, the file's size and length, and progress while it uploads.
  - **HLS streaming without a video service.** With `stream: { type: "hls" }`, the Studio converts an upload to an HLS stream in the editor's browser before it uploads it. It makes one H.264 rendition per height (1080p, 720p and 480p by default, and never larger than the upload) and stores them as a folder of files next to your other uploads. Nothing is installed in your app for this: the converter ships inside the Studio and is only downloaded when someone uploads to a streaming field. A browser that can't convert (no WebCodecs, or a non-https address) uploads the original file and says so.
  - **Poster:** pause on a frame and choose "Use current frame". The frame is saved as an image, and `posterTime` records where it was taken.
  - **Start and end:** play part of a video without cutting the file.
  - **Focal point:** marks what must stay in frame when the page crops the video.
  - **Description:** text for people who can't see the video.
  - **Captions:** one WebVTT file per language. `.srt` files are converted on upload.
  - **`<ValVideo>`** in `@valbuild/next` and `@valbuild/tanstack` renders all of the above and is click-to-edit. For HLS in browsers that can't play it natively, pass `hls={() => import("hls.js")}`. It is only loaded when it's needed.
  - **Rename** a video in the Studio. An HLS stream is renamed as a whole: every playlist and segment moves to the new folder.
  - `npx val validate --fix` fills in `mimeType`, `width`, `height` and `duration` for a hand-written `.mp4`, `.mov`, `.webm`, `.mkv` or HLS video, on disk or on Val Remote. A remote video is not downloaded: only its headers are read, usually in one to three small requests.
  - `.remote()` works for videos. `npx val validate --fix` moves a video to Val Remote, or back into the project, together with its poster, captions and every file of an HLS stream.

  A video value always has a `mimeType`: it is how a page knows whether it has an `.mp4` or an `.m3u8`.

  New: `s.videoset()`, a collection of videos, like `s.imageset()` for images.

  ```ts
  const videosVal = c.define(
    "/content/videos.val.ts",
    s.videoset({ dir: "/public/val/videos", stream: { type: "hls" } }),
    {},
  );
  const schema = s.object({ intro: s.video(videosVal) });
  ```

  - **Upload once, set it up once, use anywhere.** A set's entry holds what is true of the file (its type, size and length) and, as defaults, a description, poster, start and end, focal point and captions. A field that picks from the set (`s.video(videosVal)`) gets all of those, and can override any of them on its own. For example, the same clip can open one page at 0:02 and every other page where the set says.
  - **Media in the Studio.** A set is listed under Media and opens as a gallery of videos, with each video's poster as its thumbnail. Hovering a video previews it, and the selected video plays in a real player (HLS streams too) beside the poster, times, focal point and captions you edit for it. You can upload into the set (with `stream`, uploads become HLS streams, and each upload gets a poster), rename a video, and delete a video that nothing uses. Renaming a video updates every field that uses it. An HLS stream is one entry, and renaming or deleting it moves or removes all of its files.
  - **Picking.** A set-backed field picks from the set, or uploads into it. Each value the set provides is marked "From gallery · Override", and once overridden, "Overridden · Use gallery's".
  - `useVal` and `fetchVal` fill in what the set holds (`mimeType`, `width`, `height`, `duration`, and every default the field does not override), so `<ValVideo>` works the same either way.
  - `.remote()` works for sets. `npx val validate --fix` fills in missing metadata for an entry, adds untracked videos found in the set's directory, and moves a set's videos to Val Remote.

  Image and file galleries use the same new gallery layout: a grid or list of entries, with the selected one open in a panel beside it.

  - An `s.imageset()` entry can hold a default focal point, as well as its description. An `s.image(galleryVal)` field shows both, and can override either.
  - Fixed: outside draft mode, `useVal` and `fetchVal` now fill a gallery-backed image or file from its gallery (dimensions, mime type, description). Before, a published page got only the `path`.

### Patch Changes

- [#801](https://github.com/valbuild/val/pull/801) [`9cbe428`](https://github.com/valbuild/val/commit/9cbe42895d006d55c3d993dc27f0779808b85306) Thanks [@freekh](https://github.com/freekh)! - Emptying a field in the preview's "On this page" list no longer removes it from the list while you are editing it.

  The list shows what the page renders, and a field you empty often renders nothing: an empty rich text, an image set to none, or a link whose label was cleared. The row you were typing in used to vanish, taking your cursor with it, and clearing a link's label also removed its URL from the list. Now a field you have worked on stays where it was, marked "Not on page", until you reload the page with the canvas's reload button or go to another page. A field you delete from the content, such as a removed list item, still goes away at once.

- [#804](https://github.com/valbuild/val/pull/804) [`fb5f097`](https://github.com/valbuild/val/commit/fb5f09721ac07f4d90b8502fdbee3fb3884d9688) Thanks [@freekh](https://github.com/freekh)! - A remote image, file or video field no longer uploads a file as local when it is picked right after the Studio opens. The field stays disabled until the Studio has chosen a remote bucket, as remote galleries already did. Before that, a file picked in that moment was given a local path and uploaded as a local file, even though the field was remote.

- [#798](https://github.com/valbuild/val/pull/798) [`6473a2e`](https://github.com/valbuild/val/commit/6473a2efe874f1749b27ed6f8ac4e0d19805edb1) Thanks [@freekh](https://github.com/freekh)! - Pressing Save or Publish while your last edit is still on its way to the server no longer fails with "Cannot publish: your latest changes could not be saved". Before, the Studio gave that edit 5 seconds to arrive. A save that was only slow was then refused as if it had failed, even though the change reached the server a moment later and the status bar said "All changes saved".

  This happened most often in local development, when you saved twice in a row: saving rewrites your `.val.ts` files, the dev server recompiles, and the next save waits for that rebuild.

  The Studio now waits for a save that is still in progress. It stops waiting, and tells you, when the save keeps failing, or when the server has not answered at all after 60 seconds.

## 0.140.2

### Patch Changes

- [#792](https://github.com/valbuild/val/pull/792) [`df1e5f5`](https://github.com/valbuild/val/commit/df1e5f5f94391f25c71839cc476a51198b90db4d) Thanks [@freekh](https://github.com/freekh)! - The Publish button no longer turns green while a publish is still running, in any tab or on any device. Before, the changes being published still counted as unpublished until the publish went live. So from about 64% on the progress, Publish lit up over them again: in the tab that pressed it, in every other open Studio, and on another device.

  The button now reads "Publishing" for those changes until the publish is live, and you can press it again only for changes made since. If a publish fails, its changes become publishable again straight away.

  Val Build's content service now reports which changes a running publish holds, and the Studio reads that from `/stat` and the live connection. A content service that doesn't report it keeps the previous behaviour, except in the tab that pressed Publish.

## 0.140.0

### Minor Changes

- [#769](https://github.com/valbuild/val/pull/769) [`cb93874`](https://github.com/valbuild/val/commit/cb938748aec15fd0ac3814c1696a2dd78ad63c27) Thanks [@freekh](https://github.com/freekh)! - The project name in the Studio's top bar is now a project switcher, for projects connected to Val Build. It shows the project you are in, the projects you pinned and the five you opened most recently, and searches every project in your organisations. Choosing one opens its Studio.

  The top bar also gets a **Share** button (an icon on a phone). It shows who is in the project's organisation. Owners can create invite links for a role (each works once and expires after 7 days), see and revoke pending links, and change members' roles. Everyone else can see the members and which owners to ask.

  The assistant can be set up from the Studio too. Settings › Assistant shows the AI key this project runs on and whether it works. From there you can add a key, update it, remove it, or choose one that already exists: the organisation's, your own, or another project's. The assistant's empty state offers the same when no key is set up. Every key is checked with the provider before it is saved, and once a key is saved the assistant turns on without a reload.

  The panels are served by Val's content server (`content.val.build/wc/v1/project-switcher.js`, `members.js` and `ai-setup.js`), beside the API they read and write, so they can improve without a Val release. The Studio draws the project name and the Share button itself, and loads the switcher and Share panels only when the button is first hovered or clicked, so opening the Studio fetches nothing extra. If a panel cannot load, for example offline or under a strict Content Security Policy, the click opens the same page in Val Build instead, and the AI setup is a link to the project's AI keys there. If your app sets a CSP, allow `script-src https://content.val.build` to get them.

  They reach Val Build through a new route on your app's Val server, `/api/val/admin/proxy/*`, which adds the editor's existing Val Build session. That route forwards only to the Studio API on Val's content server (`/v1/studio/*` on `VAL_CONTENT_URL`, `https://content.val.build` by default), and only with the `x-val-studio` header that a cross-site request cannot send.

  In local development they appear once you have run `val login`, and use that login. Without one the Studio keeps the plain project name, as before; it does not load them just to say you are not logged in.

## 0.139.2

### Patch Changes

- [#789](https://github.com/valbuild/val/pull/789) [`4d9e12c`](https://github.com/valbuild/val/commit/4d9e12c5286f981c7a8a7820db1bf580e327d2ea) Thanks [@freekh](https://github.com/freekh)! - A change you publish no longer disappears from your open Studio while the site is building.

  Before, when a publish was made for you on the server (or from another of your tabs or browsers), an open Studio could go back to showing the value from before the publish, and offer to publish again, until the page was reloaded. It now keeps showing the published value until the new build is live, the same as a reload does.

- [#787](https://github.com/valbuild/val/pull/787) [`1c3eb3a`](https://github.com/valbuild/val/commit/1c3eb3af91f6dfeff94a95d80d5291a1acf1baf2) Thanks [@freekh](https://github.com/freekh)! - Staging or unstaging a change while the Studio is still saving an edit no longer gets undone by that save.

  Saving an edit also adds it — and whatever it was written on top of — to your staged changes, and the server applies a save and a stage/unstage in whatever order they arrive. Unstage something while an edit on top of it was still being saved, and the save could land second and quietly stage it again; or the edit could end up staged without the change beneath it, which a reload then showed. Now a stage or unstage made during a save is sent once the save has been answered, an unstage takes with it any just-saved edit that depends on what it removes, and what is staged after a reload is what you last chose.

## 0.139.1

### Patch Changes

- [#785](https://github.com/valbuild/val/pull/785) [`238057d`](https://github.com/valbuild/val/commit/238057d2f17a6bdd22d0bd4316dd8e3a8843a85d) Thanks [@freekh](https://github.com/freekh)! - Publishing has one indicator in the Studio's status bar, and it spins until every visitor sees the change.

  - **Publishing 42% → Reaching visitors 94% → Live**, with a progress bar. Live is not the end: each edge may serve the previous version for up to a minute after the site switches, so the indicator keeps spinning, and the bar keeps filling, until that has passed. When it stops, every visitor sees the change. The step ("Building", "Uploading 3 of 7") is on hover.
  - **It spins for anyone's publish**, not only yours: another editor's publish shows here too.
  - **One "Published" toast**, for the person who published, when every visitor sees the change, instead of at the moment the site switched.
  - **The Deployments list no longer opens by itself.** Click the indicator to see it.
  - **Safari:** the Studio no longer shows a second progress card while the builder tab works. The builder tab now reports its percentage, so the Studio's bar matches it, and the card only appears when the tab was blocked or failed.

- [#777](https://github.com/valbuild/val/pull/777) [`8f08418`](https://github.com/valbuild/val/commit/8f0841882d13c991d31dfbb03dd4873c9ab636b4) Thanks [@freekh](https://github.com/freekh)! - Changes you make in one browser or tab now show up in your other open Studios without a reload, and are included when you publish from them.

  Before, a Studio that was already open kept showing the old value for a change you had made somewhere else, and publishing from it left that change out, until the page was reloaded. A change you have unstaged in a Studio stays unstaged there.

- [#785](https://github.com/valbuild/val/pull/785) [`238057d`](https://github.com/valbuild/val/commit/238057d2f17a6bdd22d0bd4316dd8e3a8843a85d) Thanks [@freekh](https://github.com/freekh)! - The publishing percentage no longer falls back after the upload. A publish built in the Studio tab used to climb to about 60%, drop to 8% while the tab handed the build over, and then jump to 64%. It now goes straight from the upload to the site check.

- [#780](https://github.com/valbuild/val/pull/780) [`db13bed`](https://github.com/valbuild/val/commit/db13bed902f9f9147feb5be07ce47fe8b5b143f9) Thanks [@freekh](https://github.com/freekh)! - When a new version of your site with a changed schema is deployed while Val Studio is open, the Studio now asks you to reload before you keep editing, instead of carrying on with the old schema.

- [#781](https://github.com/valbuild/val/pull/781) [`5ea70ce`](https://github.com/valbuild/val/commit/5ea70cefde3c74961cfa76b4a5f4c333b850b60a) Thanks [@freekh](https://github.com/freekh)! - Every open Studio now shows the same changes, staged the same way, as a reload would.

  - Staging or unstaging a change in one browser or tab now shows up in your other open Studios right away, without a reload, and publishing from any of them ships the same set.
  - A change you stage before you have made any edit of your own is saved straight away, instead of being kept in the tab until your first edit and lost if you reloaded first.
  - If staging a change fails, the Studio now goes back to showing what is actually saved, instead of keeping the failed change on screen until a reload.

  This needs the Val Build content service released alongside this version.

## 0.139.0

### Minor Changes

- [#776](https://github.com/valbuild/val/pull/776) [`3eb5031`](https://github.com/valbuild/val/commit/3eb503167ae466ee586303c95efcc14665129481) Thanks [@freekh](https://github.com/freekh)! - **Breaking:** `.render({ as: "inline" })` now goes on the list, not on its items.

  You now write `s.array(item).render({ as: "inline" })` and `s.record(item).render({ as: "inline" })`. Each item is then edited in its own row instead of in a preview row you click into. The list decides. The item schema stays reusable, and a page builder made of tagged blocks needs nothing on each block:

  ```ts
  // before
  s.array(
    s.discriminatedUnion(
      "type",
      hero.render({ as: "inline" }),
      text.render({ as: "inline" }),
    ),
  );

  // after
  s.array(s.discriminatedUnion("type", hero, text)).render({ as: "inline" });
  ```

  What changed:

  - Only `s.array()`, `s.record()` and `s.keyOf()` have `.render(...)` now. On every other schema the method is gone, so the old placement shows up as a type error. Move the render out one level.
  - The render only affects the list's own items. A list nested inside one of those items keeps its default unless it has its own `.render`.
  - `s.router()`, `s.imageset()` and `s.fileset()` throw if you give them a render, because pages and media have their own editors.
  - `s.keyOf(...).render({ as: "inline" })` means the same as before: the selected entry's content is shown below the dropdown.

  **Watch for one case that still compiles:** an array or record that is itself the item of another list. `s.record(s.array(s.string()).render({ as: "inline" }))` used to show the record's arrays inline. Now it shows each array's strings inline. To keep the old layout, write `s.record(s.array(s.string())).render({ as: "inline" })`.

## 0.138.6

### Patch Changes

- [#774](https://github.com/valbuild/val/pull/774) [`9d28775`](https://github.com/valbuild/val/commit/9d287750631b239b70bc7545e3b9fa9011e81db7) Thanks [@freekh](https://github.com/freekh)! - Publishing from a phone is quicker to follow, and fails less.

  - The builder tab closes once it has built and uploaded your change. Checking that the site renders and putting it live no longer need the tab, so you don't have to keep it open.
  - After the builder tab closes you get one "Published" message, not three.
  - If a publish fails, the builder tab gives the same reason as the Studio's message, not a vaguer one.
  - If the builder tab is closed, or your phone pauses it in the background before it finishes, you're no longer stuck with Publish greyed out until you reload. After a short wait the Studio says the tab stopped answering, and pressing Publish again picks the publish up where it left off. Nothing is lost or published twice.
  - A publish no longer fails with "This deployment cannot prepare a publish job for this project" when the site happens to answer from a server that hasn't loaded your changes yet.

## 0.138.5

### Patch Changes

- [#772](https://github.com/valbuild/val/pull/772) [`c532afc`](https://github.com/valbuild/val/commit/c532afc1818ee0249ad227a7da029c3e8d06baa8) Thanks [@freekh](https://github.com/freekh)! - Publishing a Git-connected project no longer locks the Studio while it waits for CI, and works from a phone.

  - The Publish button stays available while a publish waits for the server or for CI. You can publish your next changes straight away, and they go out as a new publish. It is only held while this browser is building or uploading.
  - On an iPhone or iPad, the Studio now builds the site in a separate builder tab instead of waiting for CI. Safari, and every other iOS browser, can't run the build on the Studio's own page. Projects without a repository already worked this way.

## 0.138.4

### Patch Changes

- [#771](https://github.com/valbuild/val/pull/771) [`63bff05`](https://github.com/valbuild/val/commit/63bff0589b6df42efaa63ec606688d20a9670439) Thanks [@freekh](https://github.com/freekh)! - Changes that are already published no longer briefly vanish from the Studio, or show up twice, right after a publish in app mode.

  A build the Studio makes in the browser now records which publish it was made for, so Val knows exactly which changes the running site already has. Before this, Val worked that out from whichever build was live, and was wrong for a moment while a publish was going live. A reload in that moment could hide changes that were not on the site yet, or apply ones that were a second time. Projects set up before this release need no changes.

- [#770](https://github.com/valbuild/val/pull/770) [`0a885b1`](https://github.com/valbuild/val/commit/0a885b1f0304517b167b959958464066194732d0) Thanks [@freekh](https://github.com/freekh)! - Publishing a Git-connected app-mode project now puts your changes on the site in seconds, instead of waiting for CI.

  - The Studio builds the site in the browser, the same way it does for a managed project. Val pushes the commit to your repository as before. When nothing but content has changed since the build the site is serving, the browser's build goes live right away. If a developer has pushed code in between, the site waits for CI's build, so their code is never taken off the site.
  - If the browser cannot build, the publish still goes through and CI delivers it. This happens when the page is not cross-origin isolated, or when the build keeps failing. Your changes stay visible in the Studio until the site serves a build that has them.
  - Content that would break a page is caught before anything is pushed to your repository.

- [#753](https://github.com/valbuild/val/pull/753) [`8b1e47e`](https://github.com/valbuild/val/commit/8b1e47e50f9556d8469358af93ba32a084e2e131) Thanks [@freekh](https://github.com/freekh)! - URLs in rich text become links without the link dialog.

  - **Paste** a URL, or text with several in it, and each becomes a link. A chip under the paste says so, and **Keep as text** undoes just the linking (⌘Z still undoes the whole paste). Pasting one URL over selected text links the selection.
  - **Type** a URL and it becomes a link when you type the space or press Enter after it.
  - **Ctrl/⌘+K** links the URL the cursor is on. On a link or a selection, it opens the link editor.
  - A bar under the field lists URLs that are still plain text: **Link all**, or **Review** to choose which ones.

  A URL on the site itself becomes an internal link: pasting `https://blank.no/jobb` into blank.no's Studio gives `/jobb`. If there is no such page, it is not linked. It is highlighted as an error, both in the text and in the bar. Links that already point at the site's full address can be fixed the same way.

  In a field that can only link to the project's routes (`s.richtext({ a: true })` or `a: s.route()`), an external URL can only be linked once it is one of the project's external pages. If the project has an external pages router, the bar offers **Add & link**: it adds the URL there and links it. Without one, or for a URL the router's `schemes` or the field's `include` / `exclude` would refuse, the bar only says it can't be linked.

  The site is recognised by the address the Studio is open on. So on a local dev server, URLs copied from production are treated as external.

- [#767](https://github.com/valbuild/val/pull/767) [`4268beb`](https://github.com/valbuild/val/commit/4268beb4beec53cb52584f59f9bbd5ffdcc9095d) Thanks [@freekh](https://github.com/freekh)! - The compare dialog on the review page can now be linked to. `/val/review?compare` opens it, and `/val/review?compare=<source path>` opens it on that change and highlights the row. Closing the dialog removes the parameter from the URL. A link to a change that isn't staged opens the review page without the dialog, so the change shows under Unstaged.

  "View in Compare" in a media gallery's file properties now uses this: it's a real link that opens the dialog on that file's change, instead of going to the old compare view. It also appears for files whose only change is the description (alt text). Before, an edited description didn't count as a change, so neither the link nor the file's authors were shown.

- [#768](https://github.com/valbuild/val/pull/768) [`e79451f`](https://github.com/valbuild/val/commit/e79451faab37f46e2039d681a19eea06d537dc44) Thanks [@freekh](https://github.com/freekh)! - The Studio no longer blinks while you type.

  - The Publish button kept switching between "Fix 1" and "Publish" on every pause in typing whenever the module being edited had a validation error, and the error message under an invalid field disappeared and came back each time. Errors now stay on screen while the module is re-checked, and are replaced when the new result arrives.
  - The status bar stays on "Saving…" while you type, then settles on "All changes saved", instead of switching between the two after every pause.
  - The save indicator keeps the same width in every state, so the items beside it in the status bar no longer shift.

## 0.138.3

### Patch Changes

- [#759](https://github.com/valbuild/val/pull/759) [`a6cefc8`](https://github.com/valbuild/val/commit/a6cefc870436c9f981d6b831c318416eb6f506e6) Thanks [@freekh](https://github.com/freekh)! - The AI assistant now shows how long a reply is taking and how many tokens it has written, under each reply.

  - **While the assistant works**, a line under the reply says what it is doing — `Thinking…`, `Writing…`, or `Working…` while it runs a tool — with a timer and a count of output tokens that climbs as it goes: `Working… 1m 05s · ↓ 2.1k tokens`. The count also moves while a model thinks or writes a large edit before saying anything, where the service reports it. This line replaces the three dots.
  - **When the assistant asks you a question**, the timer pauses and the line reads `Waiting for your answer`, so the time shown is the assistant's, not yours.
  - **When the reply is done**, the line settles to the total: `1m 34s · 3.4k output tokens`. A stopped reply says `Stopped after 18s`, a failed one `Failed after 31s`. A count marked `~` is an estimate made in the browser, shown when the service did not report an exact one.
  - Only **output** tokens are counted: what the model wrote, including its thinking and tool calls. The context sent back to the model on every tool call is left out.
  - **Long replies are no longer cut off at two minutes.** The assistant gave up on any reply still running after two minutes, showing "Response timed out" and dropping the answer when it arrived. It now gives up only after two minutes with no activity at all, so a reply that keeps writing, calling tools or reporting progress runs as long as it needs.
  - Conversations reopened from history show no timer or count. Those are only kept for replies you watched arrive.

- [#764](https://github.com/valbuild/val/pull/764) [`9d062c2`](https://github.com/valbuild/val/commit/9d062c23597d47d80b66a94091442c5409e7e415) Thanks [@freekh](https://github.com/freekh)! - Pressing Save (or Publish) right after typing now saves what you typed. With changes already pending, pressing the button the moment you finished typing did nothing and showed nothing: the press is what writes your last edit, and the button switched itself off while that write was on its way, so the click was dropped. The button now stays pressable, and the save waits for the last edit before it runs. The button also no longer remounts whenever it switches between enabled and disabled.

## 0.138.2

### Patch Changes

- [#763](https://github.com/valbuild/val/pull/763) [`2beb226`](https://github.com/valbuild/val/commit/2beb226446c76eb71026f43e04c13943da4a1e31) Thanks [@freekh](https://github.com/freekh)! - When a publish fails because the Studio could not build the site, the editor is now told why. The tab that built it sends its reason with the failed step, so the message reads, for example, "build failed 3 times: Tailwind's '@plugin' is not supported here…" instead of just "build failed 3 times". This needs the content service that accepts the reason; an older one ignores it and shows the message as before.

- [#760](https://github.com/valbuild/val/pull/760) [`cf3bbc8`](https://github.com/valbuild/val/commit/cf3bbc8fc89ff349aac5ab101d0b4f28164583e6) Thanks [@freekh](https://github.com/freekh)! - Files and images can now be renamed in the Studio, for local files and remote ones.

  - **Rename a file in a gallery** from its properties: click the pencil next to the file name. Every field that uses the file is updated to the new name in the same step, including images inside rich text, and the dialog says how many places will change before you save.
  - **Rename the file of an image or file field** with the new **Rename** button. A field that picks its file from a gallery sends you to the gallery instead, because other fields may use the same file.
  - **You choose the name, Val keeps the rest.** The short hash at the end of the name (`_a1b2c`) and the file extension stay as they are, so two different files can never end up with the same name. The name is cleaned up the same way an upload's is: lower case, and characters that do not belong in a URL are dropped.
  - **Renaming a local file moves it.** The file is saved under the new name and the old file is deleted when you publish, so nothing is left behind to clean up. If another field uses the same file without going through a gallery, pick the file again in that field.
  - **Renaming a remote file is instant.** Remote files are stored by their content, so a published remote file only gets a new address and nothing is uploaded again.
  - **Gallery images used in rich text now count as references.** A gallery file used only inside rich text could be deleted, which left the text pointing at nothing. It is now listed under the file's references and blocks the delete like any other use.

## 0.138.1

### Patch Changes

- [#755](https://github.com/valbuild/val/pull/755) [`1d1bb1e`](https://github.com/valbuild/val/commit/1d1bb1e5937a4194f79e1df040cb800e6bbcb865) Thanks [@freekh](https://github.com/freekh)! - The focal point of an image is now saved where you click, images are shown centred on it, and the image field has a new look.

  - **The saved focal point was wrong for images narrower than the field.** A portrait photo was letterboxed inside the picker, so a click was measured against the empty space around the picture as well as the picture itself, and then shifted 6px up and to the left. Clicking a subject at 70% across could save 55%. Clicks now land exactly where the marker is drawn. You can also drag the point, and a drag saves once when you let go. From the keyboard, tab to the point and move it with the arrow keys (hold Shift for bigger steps). Focal points saved before this fix are not changed; re-pick any that look off.
  - **The image preview dialog is centred on the image.** It used to fill most of the screen, with a portrait image pinned to its left edge and the focal-point marker drawn in the empty space beside it. The dialog is now the size of the image, the marker is on the picture, and a footer shows the file name, dimensions and focal point.
  - **Thumbnails are cropped around the focal point.** They used to shrink the whole image into the tile, which showed a portrait image as its top strip and a landscape one as a thin band. Thumbnails in image fields, galleries and the media picker now fill the tile and keep the focal point, or the centre when none is set, in frame. Images smaller than the tile are still shown at their own size rather than enlarged.
  - **The image field shows the image as a page would.** A 16:9 preview cropped around the focal point replaces the small thumbnail, with the file name, dimensions, type and focal point under it. Click it to see the image large. Replace and Remove appear over the image on hover, and stay visible on touch screens and while a keyboard is focused on the card.
  - **Drop an image onto an image field** to upload it. An empty field is a drop zone, and dropping onto a filled one replaces the image. A file the field does not accept is refused with a message saying which types it takes, checked after any conversion the field is set to do.
  - **Upload progress** is a bar along the bottom edge of the field instead of a spinner over the picture.
  - **Transparent images show a checkerboard** behind them (PNG, WebP, GIF, AVIF and SVG), in the field, the focal point picker and the large preview, so a logo on a transparent background is visible in dark mode too.
  - **Where there are many images or little room** — a list whose items are edited inline, the canvas side panel and the in-page editor — the field is a smaller card, with the file name and buttons beside the picture instead of a full-width card per item.
  - **Images in list rows are square thumbnails cropped at the focal point**, the same as in record rows. They used to be the whole image shrunk to fit, so every row was a different shape. A just-uploaded image in a row now shows straight away instead of appearing broken until saved.

## 0.138.0

### Minor Changes

- [#754](https://github.com/valbuild/val/pull/754) [`6216172`](https://github.com/valbuild/val/commit/62161729aa40f737590b0a8093c0394385fffd8d) Thanks [@freekh](https://github.com/freekh)! - Connected projects hosted on the Val platform publish as a queued job too.

  For a project with a GitHub repository whose site runs on the Val platform, pressing **Publish** is now a request, just as it is for a managed project. The Studio sends the job's changes; the content service pushes them as one commit on top of whatever is on the branch at that moment, so a developer's code push in between is kept. CI then builds it. A developer's change to the site's content files that this deployment has not seen stops the publish before anything is pushed, and says so.

  - A build that CI reports as failed shows "Published, not on the site yet", with **View run**. The next publish builds again.
  - New CLI command, `val ci-report --status failed|succeeded`, for a workflow's last step. It reads the commit, the branch and the run's address from GitHub Actions, uses the same `VAL_PROJECT_TOKEN` as `val publish`, and never fails the job.

  Connected projects on a host of their own (for example Vercel) publish exactly as before.

- [#754](https://github.com/valbuild/val/pull/754) [`40e933d`](https://github.com/valbuild/val/commit/40e933da7fe01cfe1c3f4a43c156f0b2f8a11f62) Thanks [@freekh](https://github.com/freekh)! - Publishing a managed project is now a queued job, and a publish is either live or it did not happen.

  Pressing **Publish** in a managed project no longer commits first and builds after. It asks the content service for a publish job and returns at once; the Studio tab that pressed builds the job and uploads it, and the content service checks the build renders and makes it live — recording the commit only then. So there is no longer a "Saved, not yet live" state to get stuck in, and no **Finish publishing** button to get out of it.

  - A press made while another publish is going out is queued behind it, and built when its turn comes by whichever open Studio tab is free.
  - A tab that closes after uploading costs nothing: the rest of the publish is the content service's.
  - A publish that fails before it goes live says so, with **Try again** and **Discard changes**. Your changes are kept either way.
  - Publishing from the site (a page that cannot build) still opens a Studio window to build it; the window now runs the publish job for the page.

  Connected projects (with a repository) that are hosted on the Val platform publish as a queued job too — see the note on connected projects. Those hosted elsewhere, for example on Vercel, publish exactly as before.

  For the Val server: the publish proxy now forwards the publish-job routes, `/api/val/publish-job-prepare` renders a job's sources and hands content its archive, and `/api/val/built-source` is removed.

- [#751](https://github.com/valbuild/val/pull/751) [`5876fe0`](https://github.com/valbuild/val/commit/5876fe075fdee1f76f1cdaa2488ac52c58c894a8) Thanks [@freekh](https://github.com/freekh)! - Publishing no longer asks for a commit message by default.

  - **Publish publishes.** In HTTP mode, pressing Publish goes straight to publishing, just as Save already did in local development. Where an AI model is available it writes the commit message (the button reads "Preparing" meanwhile, for up to 15 seconds). Otherwise the message is built from what changed, and names the exact path when a single field changed, e.g. `Update hero.title in /content/home.val.ts`. When several things changed, the message body lists the changed modules and their fields: up to six modules and five fields each, then how many more.
  - **`studio.commitMessage: "required"`** in `s.settings()` brings the box back, redesigned. Editors can turn it on from the Studio too: Settings → Studio → "Ask for a commit message". It opens empty rather than pre-filled, so a message cannot be published unread. The AI fills it in when it can, and Publish stays disabled until there is a message. Nothing publishes on its own: the countdown that published while the AI was still writing is gone.
  - **The overlay menu stays open** while the commit message popover is open, or a publish is under way. Before, moving onto the popover collapsed the menu and the popover moved with it.

### Patch Changes

- [#752](https://github.com/valbuild/val/pull/752) [`57af895`](https://github.com/valbuild/val/commit/57af8959cc46519a405b1ed7441623f8bf2e6d27) Thanks [@freekh](https://github.com/freekh)! - `s.date()` now reports a value that is not a real `YYYY-MM-DD` day as a validation error. It used to check only `from` / `to`, and compared those as plain strings, so a typo like `"19f81-12-30"` passed a `.from("1900-01-01").to("2024-01-01")` range without a word. Impossible days such as `"2023-02-29"` are rejected too, and a `from` / `to` bound that is not a valid date is reported as a schema error.

  The Studio's date field no longer shows a year below 100 (`"0050-01-01"`) as empty: it was read as 1950 and discarded.

- [#744](https://github.com/valbuild/val/pull/744) [`c523506`](https://github.com/valbuild/val/commit/c523506c8b5e148864f401c005b913330e436499) Thanks [@freekh](https://github.com/freekh)! - A deploy that has reported itself as queued or building for more than an hour is now shown as **Status unknown** instead of building.

  The build state comes from the hosting provider. When those updates stop arriving, a publish used to show a spinner indefinitely. The status bar, the deploy list, Recent activity and the compare view now all say "Status unknown" once the hour has passed, and switch over at that moment without needing a reload. A publish the site is already serving still shows as live. In a project the Studio deploys itself, a commit is recorded only once its build is live, so a row the site does not serve was superseded and reads "Published".

- [#744](https://github.com/valbuild/val/pull/744) [`c523506`](https://github.com/valbuild/val/commit/c523506c8b5e148864f401c005b913330e436499) Thanks [@freekh](https://github.com/freekh)! - The first edit after a publish no longer says "1 change was added to your changes".

  A published patch stays in the list of changes until the deploy lands. The Studio took it for an earlier edit that yours depended on, sent it along with your save, and showed the toast. Published patches are now treated as already shipped, which is how the publish check already treats them.

## 0.137.0

### Minor Changes

- [#676](https://github.com/valbuild/val/pull/676) [`daecf41`](https://github.com/valbuild/val/commit/daecf416f51990569a47a6a9ee9174b1a57f98c2) Thanks [@freekh](https://github.com/freekh)! - External pages have their own place in Val Studio.

  They used to be a second list under the site map in the Pages panel: two dozen
  flat rows that pushed the site map out of view and answered none of the
  questions anyone opens them with. There is now a button at the bottom of the
  Pages panel — with a count, and a second count for how many want looking at —
  and behind it a dialog built around what external pages actually are: a list of
  URLs.

  - **Grouped by domain**, so a project's `status.`, `portal.` and `shop.` links
    read as one cluster rather than three strangers. Flat is a toggle away. A
    `mailto:` groups under the domain it writes to, beside that organisation's
    web pages; a `tel:` gets a heading of its own.
  - **Where each URL is used.** Every row says how many places link to it, and
    opening one lists them and takes you there. A link nothing points at is the
    one you can delete; a link twenty things point at is the one you cannot
    rename casually — and until now neither was visible.
  - **What is behind it**, without leaving the list: the entry's own fields in a
    detail pane beside the URLs.
  - **Add and remove.** A URL can be added from the dialog — which then opens and
    scrolls to what it added, rather than dropping it somewhere in a list sorted
    by a grouping you were not thinking about — and removed from it, but only
    once nothing links to it, which is a thing you could not previously find out
    without reading the project.
  - **Validation errors per entry.** A `.validate(...)` your project wrote on the
    external router's item schema now shows on the row it is about, and says what
    it found in the detail pane. Every external page lives in one module, so a
    module-level count said the same thing on every row and was left off
    entirely.
  - **Checks.** Press Check on a selection, or on everything, and Val reads the
    URLs for the mistakes that get made while typing and then never looked at
    again: a key the router will refuse, a password pasted into a URL, the same
    page listed twice, an `http://` link whose `https://` twin is already in the
    list, a localhost address someone added from their laptop, tracking
    parameters.
  - **Link checking.** The same button also opens each URL through your own
    server and reports what answered: 404 and 410 as errors, a redirect that
    still works as a warning naming where it went, and 401/403/429 as "may be
    fine for a visitor, cannot be checked from here" rather than as broken. URLs
    go up ten at a time and failures are retried, so checking a few hundred links
    is polite to the sites on the other end. A `mailto:` or `tel:` is reported as
    having nothing to open, never as unreachable.

    The report is the findings, not a transcript: the clean rows are a number,
    and each flagged one is one line, worst first. Twenty clean URLs are "All 20
    look fine."

    The endpoint this adds makes outbound requests to addresses your content
    supplies, so it refuses to connect to anything that is not a public internet
    address - loopback, private ranges, and the cloud metadata service that hands
    out credentials - checked on the resolved address, at every redirect hop.

- [#746](https://github.com/valbuild/val/pull/746) [`e2bfc0e`](https://github.com/valbuild/val/commit/e2bfc0e40383fe25d3ec0473d1032f6264a8939f) Thanks [@freekh](https://github.com/freekh)! - A site hosted on Val (a managed project, with no repository of its own) can now be updated from the Studio. **Settings → Updates** says whether a newer version of the software the site runs on is available, lists the packages that move and their versions, and offers **Update site**.

  Updating rebuilds the site in the browser on the new versions and publishes it through the ordinary publish, so it is checked before it goes live: if the updated site does not render, nothing changes and the site keeps running the old versions. Unpublished changes are kept and are **not** published by an update. After it goes live, reload the Studio to use the new one.

  In Safari, which cannot build the site in the Studio's own page, Update site opens a tab that builds and publishes it, the same way a publish does there, and the Studio follows its progress.

  A Studio that was opened before the site was updated no longer publishes: pressing Publish asks you to reload first, and nothing is saved until you do. Your unpublished changes are kept. Without this, a Studio left open from before an update would have built the site with the previous version of itself.

  The versions come from the template the project was made from, as the platform last built it. A project whose code lives in a repository is not offered this; its dependencies are updated there.

  For hosts: `@valbuild/server` forwards `GET` and `POST /api/val/publish-api/update-target` to the content service, beside `/build-target` and `/project-source`.

### Patch Changes

- [#738](https://github.com/valbuild/val/pull/738) [`8f60073`](https://github.com/valbuild/val/commit/8f60073e5490971a615cebbe8ea1243c67e43530) Thanks [@freekh](https://github.com/freekh)! - When a publish has to be handed to the builder (a publish from the page overlay, or from the Studio in desktop Safari), the builder now opens as a small window over the page instead of a full browser tab. It is sized to the progress card and still closes itself once the change is live. "View the site" and "Open the Studio" open a normal tab and close the builder window. On an iPad the builder is still a tab, because iPadOS always opens one.

- [#717](https://github.com/valbuild/val/pull/717) [`af7a4ba`](https://github.com/valbuild/val/commit/af7a4baa63da5d8a226166377a354cf2fc0c1d77) Thanks [@freekh](https://github.com/freekh)! - **See what has changed on a page.** The fields view of the preview ("On page")
  now marks every field with an unpublished change, and a **Changed** chip beside
  the title filters the list down to just those, so you can scan a page's edits
  before you publish. The chip shows how many fields have changed and fits on the
  title row, so it takes no extra room on a phone. A field counts as changed when
  its value differs from the published one, which is the same comparison the
  review screen makes: an edit typed back to the original is not listed, and
  neither is a field in a module nobody has touched.

- [#722](https://github.com/valbuild/val/pull/722) [`9b09bf3`](https://github.com/valbuild/val/commit/9b09bf38c9d5912f41fec1c18aa87455fd32f616) Thanks [@freekh](https://github.com/freekh)! - A review page for what is about to be published, and a compare dialog beside it

  Review used to open a diff. A diff answers "what changed"; the decision in
  front of an editor about to publish is "what is going out", which is made over
  the whole list at once — so Review now opens `/val/review`, a page of exactly
  that, with the diff one click away.

  - **Staged and unstaged, everywhere.** Two sections, with one vocabulary
    behind them: a change is staged or it is unstaged, and nothing is "held
    back" any more. What each means is in a tooltip on the heading rather than a
    paragraph under it.
  - **Selection, filters and authors.** Rows are multi-select with presets, the
    list can be narrowed to one author, and an author is shown with the same
    avatar the rest of the Studio uses.
  - **Revert without leaving the page**, over the current selection or over
    everything.
  - **Compare works in `fs` mode.** The dialog compares the staged changes
    against what is on disk — there is no published history to compare against
    there, so it does not offer one, and it says "save" where a deployed project
    says "publish".
  - **History is a route** (`/val/history`) rather than a panel, so a commit — or
    the list you pick one from — can be linked to. It stays hidden in `fs` mode,
    where restore is not supported.

  Nothing in any of these screens shows a module file path. A page is named by
  its URL and located by it; a data module is named by its own name and located
  by its folders, spelled the way the left nav spells them.

- [#745](https://github.com/valbuild/val/pull/745) [`8e49bf4`](https://github.com/valbuild/val/commit/8e49bf41ad6a8ad3b01e502fb7ce0369baa316db) Thanks [@freekh](https://github.com/freekh)! - On a phone, the Studio's bottom bar now floats above the bottom edge, with its full border and rounded corners, instead of running into the screen's rounded corners, which cut off its ends and its buttons' bottom borders.

  In the canvas's On page view, the field you are typing in is outlined once. Before, the input's focus ring was drawn inside a second accent border on the field's card.

- [#729](https://github.com/valbuild/val/pull/729) [`370d0df`](https://github.com/valbuild/val/commit/370d0df7ea45aeeafb4520318018d7c4e1c040d6) Thanks [@freekh](https://github.com/freekh)! - Publish is no longer disabled after the server refuses a change. Previously a refused change turned the button into a disabled "Fix errors" that only discarding the change could clear, even when publishing again would have worked (for example once the deployment had caught up with the previous publish). The server still refuses the whole commit when a change does not apply, so retrying cannot publish anything wrong. The refusal is still shown, and it is now cleared once a retry publishes the change. Validation errors still block publishing.

- [#676](https://github.com/valbuild/val/pull/676) [`14877a8`](https://github.com/valbuild/val/commit/14877a85c5add4daa16836470b8739180a9fe8c6) Thanks [@freekh](https://github.com/freekh)! - Finding out where a route is linked from is no longer slow on a large project.

  The scan walked the full source tree of every module in the project looking for
  `s.route()` fields, including the modules whose schema has no route field in it
  anywhere — which on a real project is most of them. It now asks the schema
  first, and only walks the source of a module that could actually hold a
  reference.

  Measured on a synthetic project of 41 modules and 4.5 MB of source: 18.2 ms per
  scan before, 0.10 ms after. The scan runs once per route key, so anything asking
  about several routes at once saves that much again per route.

- [#748](https://github.com/valbuild/val/pull/748) [`beda04b`](https://github.com/valbuild/val/commit/beda04bd326cbab18ed103e8d43917b16f43bd8c) Thanks [@freekh](https://github.com/freekh)! - A save is no longer refused once because an older answer from the server arrived after a newer one. The content service now reports a version of its list of changes, which goes up with every save, discard and publish. The Studio ignores any answer older than one it already has, including the answer to its own last save, discard or publish, so a discarded change can no longer briefly come back, and a published one can no longer briefly show as unpublished.

## 0.136.10

### Patch Changes

- [#743](https://github.com/valbuild/val/pull/743) [`fef29b0`](https://github.com/valbuild/val/commit/fef29b0d9e826e4e7e63a3ae61553137a3f9d280) Thanks [@freekh](https://github.com/freekh)! - Saving no longer gets stuck on "Changes cannot be saved: something else keeps changing them first" when another editor has an unpublished change and later work has been published.

  A new change is now written on top of the latest change the content service has registered, which it reports alongside the list of pending changes, instead of the last change this deployment was shown. Since changes can be published independently, those two can differ for good: an unpublished change can sit before published ones that the running deployment already contains. The Studio and the MCP tools both name the reported head, and fall back to the old behaviour against a content service that does not report one.

## 0.136.9

### Patch Changes

- [#730](https://github.com/valbuild/val/pull/730) [`c2bd7e7`](https://github.com/valbuild/val/commit/c2bd7e7e537f00a269a54b72274fe5efb81c0ae9) Thanks [@freekh](https://github.com/freekh)! - Changing a field back to its old value after publishing no longer disables Publish. Between a publish and the deploy that follows it, the Studio compared edits against the deployed content rather than what had just been published, so changing "Old Value" to "New Value", publishing, and then changing it back to "Old Value" was treated as "no changes" even though publishing would change the field.

## 0.136.8

### Patch Changes

- [#737](https://github.com/valbuild/val/pull/737) [`35577be`](https://github.com/valbuild/val/commit/35577be50981fec35fc27ee9435a092a26909395) Thanks [@freekh](https://github.com/freekh)! - After a publish, the Studio no longer loses edits or applies a list reorder twice while the new build is rolling out.

  The Studio shows the content built into the page it loaded, with the unpublished changes on top. Which changes those are comes from the server, and the server lists them relative to its own build. For a while after a publish the two can be different builds: a tab opened before the publish keeps its page, and a managed project's new build reaches each location up to a minute apart. The Studio then applied one build's list of changes to another build's content. Published edits went missing, or were applied a second time, which is invisible for a text replacement but reorders a list again, or removes the wrong item.

  The server already says which build answered (`sourcesSha`), and the Studio now computes the same fingerprint for the content it holds. When the two differ, it fetches the answering build's content and puts it in place together with that build's list of changes, in one step, so nothing on screen shows a half-updated state. Going back to its own build needs no fetch. When they match, which is almost always, nothing extra is requested.

## 0.136.7

### Patch Changes

- [#735](https://github.com/valbuild/val/pull/735) [`5f7a4a5`](https://github.com/valbuild/val/commit/5f7a4a5f86dfe4581fbfb402059bba70e029afdc) Thanks [@freekh](https://github.com/freekh)! - Publishing no longer gets stuck at "Building", and a publish from Safari or an iPhone keeps the edit it was made for.

  - **The site builder runs in a Web Worker.** It ran on the page, and rolldown's threaded WebAssembly sometimes has to wait for one of its own threads, which a page is not allowed to do. The build then stopped with no error and "Building" spun forever. How often depended on timing, and it happened in every browser, most visibly on iPhones. In a worker the same builds finish every time. If a build ever does stop answering, the publish now fails after five minutes with a message, instead of spinning.
  - **The builder tab builds from the files the save wrote,** as a publish built in the Studio does. It used to rely on reading the project's current source back from the site, so a publish from Safari could go live without the edit it was made for.

## 0.136.6

### Patch Changes

- [#733](https://github.com/valbuild/val/pull/733) [`562713a`](https://github.com/valbuild/val/commit/562713a2e972e603abb43259f40ccfbf06990fe5) Thanks [@freekh](https://github.com/freekh)! - Publishing works in Safari and on iPhone, and a failed publish says what happened in plain words.

  - **Safari and iOS can publish.** WebKit does not support the header that lets the Studio build in place (`Cross-Origin-Embedder-Policy: credentialless`), so a Studio in Safari, or in any browser on an iPhone, could not build at all. Its Publish, and Finish publishing, now hand the build to a small builder tab. The Val platform isolates that tab in every browser, and it closes itself once the change is live. Chrome, Edge and Firefox still build in place and open no tab.
  - **A failed publish leads with a sentence,** such as "This browser cannot build the site, so it could not be published from here", with the technical message under **Details**. This applies to the Studio's error, the builder tab and the overlay's card.

## 0.136.5

### Patch Changes

- [#731](https://github.com/valbuild/val/pull/731) [`28a71c3`](https://github.com/valbuild/val/commit/28a71c3beb40d15d628b99959c5161cee09d1871) Thanks [@freekh](https://github.com/freekh)! - The Studio's publish shows how far it has got and what it cost, and a new image no longer disappears while it is being published.

  - **An uploaded image stays visible through its publish.** Pressing Publish used to switch a new image to its published URL at once, before any build had it, so it showed as broken (and stayed broken across a reload) until the build went live. It is now served from the saved change until a deployment serves it, the same way the text of the edit is.
  - **Publishing N%** replaces the separate progress line in the status bar while a publish runs, and goes away when it is done.
  - **"Live"** once a publish is out (was "Deployed"), and a publish that went live from this browser is shown as live straight away instead of reading "Saved, not yet live" until the next status check.
  - **The deployments list** shows the step and percentage of a running publish, and how long each step took once it is live.

## 0.136.4

### Patch Changes

- [#727](https://github.com/valbuild/val/pull/727) [`d19b1f6`](https://github.com/valbuild/val/commit/d19b1f67360b057e63536ac020f7109bd2496389) Thanks [@freekh](https://github.com/freekh)! - Publishing now says how far it has got, and works from the overlay.

  - **Progress.** A publish built in the Studio shows the step it is on and how long it has run, in the status bar: loading the builder, building, uploading _n of m_, checking the site renders, going live. After it goes live the Studio waits until the site actually serves the new build where you are, and only then says "Live after 42s". A Cloudflare location can serve the previous build for up to a minute. Each publish also logs its steps and their durations to the browser console.
  - **Publishing from the overlay.** A page of the site cannot build: the bundler needs a cross-origin isolated document, and only the Studio is one. So the overlay's Publish, after you write the message, opens a Studio tab that builds and publishes the commit. A card on the page follows it to "Live after 42s". Before, a publish from the overlay was committed and then stayed at "deploying". If the browser blocks the tab, the card offers it as a button; nothing is lost.
  - The overlay's Publish button is round, the size of the buttons beside it.

## 0.136.3

### Patch Changes

- [#719](https://github.com/valbuild/val/pull/719) [`38d24f7`](https://github.com/valbuild/val/commit/38d24f723639ee109d1007854507c4571bc82575) Thanks [@freekh](https://github.com/freekh)! - A literal field in an object, such as `type: s.literal("bento-box")`, now shows its value in the Studio as a read-only text field. Before, it showed the error "Literal fields are not editable".

- [#726](https://github.com/valbuild/val/pull/726) [`3b19534`](https://github.com/valbuild/val/commit/3b19534bb7aa16452a104906d9594083c3bc3e89) Thanks [@freekh](https://github.com/freekh)! - A Studio publish of a project with no repository now ships every edit that was saved, and keeps the site styled.

  - A host that embeds the project's source can hand it to Val as `projectSource` (`initValServer(..., { http: { projectSource } })`). A publish then patches that text, not text fetched from the content service at a commit, which a project with no repository does not have. The build platform's wiring passes the build's own source, so `.val.ts` can be rendered for a project made on `/new`. Before, its first save produced no files, and the build that followed carried none of the save's edits.
  - New route `GET /api/val/built-source`: the `.val.ts` text of every module changed since the running build, with every commit since it applied. The Studio builds from it, so an edit whose own publish failed, and a Finish publishing, are no longer left out of the next build.
  - A Studio build that compiles no stylesheet (a browser cannot run Tailwind `@plugin`s) keeps the live site's. A Studio save never changes a stylesheet or a component, so the live CSS is still the right one.

- [#725](https://github.com/valbuild/val/pull/725) [`fa28164`](https://github.com/valbuild/val/commit/fa28164dfd1e05ff53eccf375334741d857fd2ef) Thanks [@freekh](https://github.com/freekh)! - When content refuses a Studio publish, the error now lists content's reasons, one line per problem (for example `COMMIT_INVALID: …`), instead of only "This publish cannot be declared".

## 0.136.2

### Patch Changes

- [#720](https://github.com/valbuild/val/pull/720) [`f76cd56`](https://github.com/valbuild/val/commit/f76cd56b9f1c1bcc0a608a7a4de24b1e776adccb) Thanks [@freekh](https://github.com/freekh)! - A managed project published from the Studio keeps its images, and a project created from a template can publish from the Studio at all.

  - A publish from the Studio carries over every file under `public/` that the site already serves, so the favicon and images no longer disappear after the first Studio publish. When content published the live build, it already holds those files and nothing is uploaded again. When it didn't (a project cloned from a template), the Studio reads them from the site it runs on and builds with them.
  - An image uploaded in the Studio is now part of the build that publishes it. For a managed project, `/save` returns the files the commit wrote (`binaryFiles`), the same way it already returns the `.val.ts` text.
  - `/save` also returns the project's branch for a managed project, and the Studio's build uses it. A project cloned from a template was wired at no commit and no branch, so its first Studio publish went out branchless and the platform refused it.
  - When neither content nor the platform can say which public files the live site serves, the Studio refuses to publish and says so, rather than publishing a site without them.

## 0.136.1

### Patch Changes

- [#716](https://github.com/valbuild/val/pull/716) [`cf89e74`](https://github.com/valbuild/val/commit/cf89e7429a79c4304ecbedd4f8b571a0de0f145f) Thanks [@freekh](https://github.com/freekh)! - A publish from a managed project now builds and ships the site, instead of stopping at the commit.

  There is no repository and no host watching one, so nothing outside the browser would have turned that commit into a running site. The publish button stays busy until the build is live, and a build that fails says the changes are saved and the site has not been rebuilt — which is the truth, and the state `Finish publishing` exists to resolve.

  A project whose pages are files under `src/routes` needs a route tree generator, which is TanStack's over babel and is not something this package can carry. A deployment supplies one on `globalThis.__VAL_ROUTE_TREE_GENERATOR__`; without it such a project is refused by name.

- [#716](https://github.com/valbuild/val/pull/716) [`c219574`](https://github.com/valbuild/val/commit/c21957498f3c7f4f47cef197c5dc0d591aa744ca) Thanks [@freekh](https://github.com/freekh)! - `Finish publishing` — a way out of `Saved, not yet live`, on the row that names the commit that is stuck.

  A managed project has nobody else to build it, so a commit whose build never ran stays that way forever: a browser closed mid-publish, a failed build, a builder that could not load. The action is the same pipeline as a publish with the gate and the commit skipped.

  It is offered per row rather than as one button, because a project can be stuck at more than one commit and a single button could only ever mean one of them.

- [#716](https://github.com/valbuild/val/pull/716) [`e673b43`](https://github.com/valbuild/val/commit/e673b43feaf48b7f30881d6786c858a0cb6a44a2) Thanks [@freekh](https://github.com/freekh)! - The Studio can run a whole publish: read what to build and what to build it from, build it, and hand the result to the content service.

  The two reads go through the same proxy and the same credential as the publish conversation, and both are validated rather than cast — an error page from a gateway in between would otherwise fail several layers down inside the bundler with a message about a module specifier.

  Generating a route tree for a file-based project is a capability the deployment supplies, like `routeSplitter` and `loadCssModule` already are. Without one, such a project is refused by name rather than failing with `UNRESOLVED_ENTRY`.

- [#716](https://github.com/valbuild/val/pull/716) [`d2f385a`](https://github.com/valbuild/val/commit/d2f385a04978992a5036379235e447ba7775faef) Thanks [@freekh](https://github.com/freekh)! - The Studio works again when served from the published package, and a managed project's publish now puts the saved edit on the site.

  - **The Studio did not start in 0.136.0.** Its main bundle imports sibling chunks by relative path, and the Studio is served at `/api/val/static/<version>/app`, so those imports resolved to paths the handler did not know and came back as the HTML fallback — which a browser refuses as a module script. Preview was gone with it. The handler now serves those chunks, and the package build follows every import the bundle makes before it lets a release through.
  - **The in-browser builder could not load.** The Studio's bundle carried rolldown's Node WASI binding, which throws `process is not defined` in a tab. It now uses the browser binding, and the build refuses a bundle that contains the Node one.
  - **A managed publish builds what was just saved.** `/save` returns the source files the commit wrote, the Studio builds with them laid over the project's stored source, and publishes that source back with the build — so the next edit starts from this one rather than undoing it. The save's commit is also passed through to the build, which previously ran as though no commit had been made.
  - **The bundler's WebAssembly is served from `content.val.build/v1/static`** (`DEFAULT_STATIC_HOST`), still addressed by its SHA-256. `globalThis.__VAL_ROLLDOWN_WASM_URL__` still overrides it.
  - The `val.server.ts` that `@valbuild/tanstack-build` generates no longer hands a save's files to the platform (`platform.internal/__api/source`). A managed project's Studio builds in its own tab, and the platform has closed that door. `isWired` recognises files wired either way.
  - `@valbuild/tanstack-build/constants` exports the contract paths and the artifact key namespace from an entrypoint that imports nothing else, for callers that must not load the bundler. The namespace gains a `source` key.

## 0.136.0

### Minor Changes

- [#713](https://github.com/valbuild/val/pull/713) [`f3a4bb7`](https://github.com/valbuild/val/commit/f3a4bb7aea604943b92545c122243798c759715c) Thanks [@freekh](https://github.com/freekh)! - The Studio can load a bundler, and it stops telling a managed project that its
  publish is on its way out.

  **A managed project is one with no repository and no host watching one.** There
  is nothing outside the browser to pick a commit up, so the Studio has been
  showing it a story that belongs to a project with a repository: a `Building`
  spinner, waiting for an event that can never arrive. It does not resolve on a
  reload, on a retry, or tomorrow, and there is no way to tell it from a deploy
  that is merely slow.

  The content service now reports which kind of project this is, as `sourceMode`
  on `/stat`, and the Studio narrates accordingly:

  - a **connected** project keeps the deploy feed and keeps `Building`, because
    there a host genuinely does pick the commit up;
  - a **managed** one says `Saved, not yet live` instead — a durable condition,
    not a phase, because nothing else will ever resolve it.

  A server that reports no source mode keeps the behaviour it has today. Absence
  means "not reported", never "managed": `fs` mode has no project to have a mode,
  and neither does a content service that predates the field.

  **The Studio also loads `@valbuild/tanstack-build` in the tab**, at mount and at
  idle, for the managed projects that will need it — a browser that is the
  deployer needs a bundler. This is the groundwork for browser-side publishing;
  the publish path itself is unchanged in this release.

  That bundler is `@rolldown/browser`, whose WebAssembly binary is 10.9 MB and is
  **not** in the npm package. It is served from `static.val.build`, addressed by
  the SHA-256 of its own bytes, so the build and the binary it needs cannot drift
  apart. A deployment that must not reach that host — an air-gapped install, a
  mirror — sets `globalThis.__VAL_ROLLDOWN_WASM_URL__` before the Studio loads and
  needs no rebuild.

  **Building in the browser requires a cross-origin isolated page.** Rolldown runs
  WebAssembly on worker threads that share memory, and a browser will not hand a
  `SharedArrayBuffer` to a worker otherwise. Without
  `Cross-Origin-Opener-Policy: same-origin` and
  `Cross-Origin-Embedder-Policy: require-corp` on the document Val is mounted in,
  loading the bundler now fails with a message that says exactly that, instead of
  a `DataCloneError` thrown from inside a worker. Nothing else in this release is
  affected: a Studio that never builds in the browser never asks.

## 0.134.0

### Minor Changes

- [#680](https://github.com/valbuild/val/pull/680) [`eaa265e`](https://github.com/valbuild/val/commit/eaa265e78d9f6d2a1b685c38901612b8a3704eed) Thanks [@freekh](https://github.com/freekh)! - Add `s.view()`: point at another module, so editors can reach it from the page it belongs to.

  Content that has to live in its own module — a `keyOf` target, shared settings, a route-keyed record — is invisible from the page an editor thinks of it as part of. A view field puts a row on that page's screen that leads to it:

  ```ts
  import employeesVal from "../data/employees.val";

  const schema = s.object({
    title: s.string(),
    employees: s.view(employeesVal),
  });

  export default c.define("/app/menneskene/page.val.ts", schema, {
    title: "Våre folk",
    employees: { view: "/data/employees.val.ts" },
  });
  ```

  The source is a pointer and nothing else. The module it names keeps its own source, patches, validation and address, and an editor who follows the row lands on that module's own screen — so it is clear they are changing something other pages use too.

  A few things worth knowing:

  - **The path autocompletes, and a wrong one does not compile.** A module now carries its own id in its type, so the source type of the field above is the literal `{ view: "/data/employees.val.ts" }`.
  - **It is not readable in code.** `useVal(pageVal).employees` is a `ValView<…>` — an opaque pointer with no fields on it. Read the module it names directly, as before.
  - **`view` is now a reserved object key**, like `_type` and `patch_id`: `s.object({ view: ... })` no longer compiles. A single `view: string` key is what a view pointer looks like, and an ordinary object with that shape would be indistinguishable from one.
  - **Views may not form a cycle.** `A → B → A`, and a module viewing itself, are reported as module errors by `val validate` and in the Studio.
  - **A pointer that disagrees with its schema is repaired automatically.** It can only happen in hand-written JSON, and the schema is the authority, so `val validate --fix` and saving in the Studio both write the module the schema names.
  - **A view's `hidden` and `readonly` are its own, never the module's it points at.** A view whose target is hidden is still shown, and still leads there.

  That last one comes with a change to what `hidden()` means on a **module's own schema**, which is the other half of making a shared module usable:

  ```ts
  // Not in the nav, and on exactly one page.
  export default c.define("/data/employees.val.ts", s.record(...).hidden(), { ... });
  ```

  It now means the nav does not list the module — the Explorer for an ordinary module, Media for a gallery — and nothing more. Previously it also blanked the module's own page, so a module you had hidden was still in the nav and showed nothing when opened. A hidden module is now reached from an `s.view()` row, from search or from a validation error, and renders in full when you get there.

  One gap worth naming rather than leaving to be discovered: a view pointing at a
  module the project does not have is reported by the FIELD — the row says the
  target is missing — but not by `val validate`. The schema check compares the
  pointer against the schema, and the cycle check deliberately skips a target that
  is not a module of the project, so neither catches it. A project-level check
  belongs with them and is not here yet.

### Patch Changes

- [#692](https://github.com/valbuild/val/pull/692) [`1c31dcc`](https://github.com/valbuild/val/commit/1c31dcca7f1bb0199350567fd579de29f48bb26d) Thanks [@freekh](https://github.com/freekh)! - `hidden()` on a module now keeps it out of every part of the nav, not just the Explorer

  `hidden()` on a module's own schema means "the nav does not list this" — a module has no parent to be hidden from, so it can mean nothing else. That rule now reaches every destination the menu has:

  - **Pages** — a hidden page router contributes no rows to the sitemap.
  - **Media** — a hidden `s.imageset()` / `s.fileset()` gallery is not offered.
  - **Settings** — a hidden settings module is not offered.
  - **Explorer** — as before.

  A hidden module is still reachable and still fully editable: from an `s.view()` row, from search, or from a validation error. Only the listing changes.

  One thing to be deliberate about: hiding a **page router** takes its pages out of the sitemap with it, so the site's URLs are listed nowhere in the Studio. That is the rule working as stated, but it is rarely what you want — hide the router only if the pages are reached some other way.

  Two settings modules remain an error rather than becoming a way to pick between them: the settings module is resolved first and dropped afterwards if it is hidden.

- [#705](https://github.com/valbuild/val/pull/705) [`688b9e3`](https://github.com/valbuild/val/commit/688b9e36b821323cda6870cdff03dd36ec3e782f) Thanks [@freekh](https://github.com/freekh)! - Fix a nullable image or file that could be filled in but never emptied.

  `s.image(gallery).nullable()` had two ways to go wrong, and between them an
  editor who added a cover image was stuck with one:

  - The tick box a nullable field is given decided which way a click went by
    looking at the source alone. A media field has a third state — no file yet,
    but the field shown, because a media value without a file is not something
    that can be written — and that state looked exactly like "off", so a field
    turned on and then off again re-ran the turn-on branch. The box stayed
    ticked and the image stayed.
  - That tick box is only drawn for a field inside an object. An image opened on
    its own — an array item, a record entry, a module whose root is the image —
    had nothing that wrote `null` at all, and a gallery-backed field could be
    pointed at a different entry but never at none.

  The field itself now offers **Remove** whenever the schema allows `null` and
  there is a file to remove, so it works on every surface, and the tick box
  decides on what it shows rather than on the source.

## 0.133.0

### Minor Changes

- [#700](https://github.com/valbuild/val/pull/700) [`802412b`](https://github.com/valbuild/val/commit/802412b92c06bc1abbca78c86885e39c8710dd83) Thanks [@freekh](https://github.com/freekh)! - http mode no longer needs a git repository

  A Val app can now run in http mode with no commit and no branch — its content
  service is the store of record, and git is an optional mirror of the code. This
  is what `fs` mode has always done: it has never had git, and it works.

  Before this, `VAL_API_KEY` and `VAL_SECRET` were not enough. `VAL_GIT_COMMIT`
  and `VAL_GIT_BRANCH` were required too, so a deployment with no commit to name
  either threw at boot or fell through to `fs` mode and reached for a working
  tree that was not there.

  **Breaking, if you pass `http` options in code.** `gitCommit` and `gitBranch`
  are replaced by one optional `git`:

  ```diff
   initValServer(valModules, config, {
     http: {
       apiKey,
       valSecret,
  -    gitCommit: process.env.VAL_GIT_COMMIT,
  -    gitBranch: "main",
  +    // Only for a project whose content is mirrored into a repository.
  +    // Omit it entirely otherwise.
  +    git: { commit: process.env.VAL_GIT_COMMIT, branch: "main" },
     },
   })
  ```

  `VAL_GIT_COMMIT` and `VAL_GIT_BRANCH` still work and are still read; they are
  simply no longer required. Set both or neither — a commit without a branch, or
  a branch without a commit, is refused at startup with a message naming the
  missing half, rather than failing later at a publish.

  **What a commit is for, where you have one.** Turning pending patches into new
  `.val.ts` text means reading the current text first, and that read goes to the
  content service at that commit. It is the publish path, not the serving path: a
  committed render reads the source compiled into the build and asks the content
  service nothing. With no repository there is nothing to write `.val.ts` into,
  so a publish records the module's data and its schema and skips the file — and
  that data is what history reads, so nothing is lost.

  **A publish can now be refused by name, before it is attempted.** If a project
  mirrors its commits into a repository but the running deployment was built
  before that repository existed, it has no commit to write the mirror against.
  Publishing anyway would save the content and silently leave the repository
  behind. The Studio now disables Publish and shows why, and `/save` refuses with
  a `no-base` code instead of failing partway.

  **Also:** `ValCommit` and `HistoricalCommit` have nullable `parentCommitSha`
  and `clientCommitSha`, and `/stat`'s `commitSha` is optional. A root commit has
  no parent, and a publisher with no repository does not report where it was. If
  you read these fields, handle `null`.

### Patch Changes

- [#674](https://github.com/valbuild/val/pull/674) [`2b9a51b`](https://github.com/valbuild/val/commit/2b9a51b7dbe2dff53b7686a4f3b7eb9bc5784fae) Thanks [@freekh](https://github.com/freekh)! - Checkboxes in Val Studio are now visible before you tick them.

  Every checkbox — the auto-save toggle, boolean fields, the change selector in
  the publish dialog — drew its border in a colour that never existed. It named
  `--primary-foreground`, a leftover shadcn token declared only under `:root` and
  `.dark`, and the Studio renders inside a shadow root where neither selector
  matches. So the border fell back to whatever colour the text beside it happened
  to be, and on a pale surface the box could not be found at all until it was
  ticked.

  Checked and indeterminate now fill, rather than differing from unchecked only
  by a small tick, and a checkbox that starts checked without being controlled
  (`defaultChecked`) draws its tick instead of rendering empty.

## 0.132.1

### Patch Changes

- [#693](https://github.com/valbuild/val/pull/693) [`c9a5cd3`](https://github.com/valbuild/val/commit/c9a5cd3a4ab5908ecb9757b7a95db17a77e3b173) Thanks [@freekh](https://github.com/freekh)! - The canvas now shows the page at the width of the pane, from the top

  The preview opened zoomed further out than it needed to be, with empty canvas
  down both sides. It was fitting the WHOLE page into the pane, and a page is
  given the height of a viewport — so the height was usually the side that ran
  out first, and the width paid for it. A 24px margin on every edge came off the
  top of that.

  It now fits the width and pins the top: the page reaches both edges of the
  pane and starts where the page starts. What does not fit is a scroll away, and
  zooming out to see more of it at once is still the `-` button. A layout
  narrower than the pane — a phone width, most obviously — is shown at 1:1 and
  centred rather than blown up past life size.

  The fit button (now "Fit page width") is the way back to that view from
  anywhere, and it works after scrolling as well as after zooming. Holding the
  fit as the pane is resized no longer scrolls the page back to the top, so
  dragging the split divider while reading half way down a page keeps your place.

- [#693](https://github.com/valbuild/val/pull/693) [`f413c5c`](https://github.com/valbuild/val/commit/f413c5cebca27ba82052825abc8c632b6177747e) Thanks [@freekh](https://github.com/freekh)! - Tighten the Studio's preview spacing: one gap under the phone's mode switch, one gap either side of the desktop divider

  On a phone the three modes each started somewhere different under the strip of
  switches, because the track cleared the strip and then every pane added a gap
  of its own on top: the address bar sat 38px below the switches, the module
  editor 26px. All three now start 12px below it — the same 12px the strip and
  the panes are inset from the sides of the screen — which gives the page 26 more
  rows of itself on the one screen size that has none to spare.

  On a desktop the canvas sat 6px from the divider's line and 12px from the
  right edge of the window, so the divider looked nudged towards the page. The
  divider's own hit area is 12px wide with the line down the middle, so the
  canvas now adds the 6px that makes both sides 12px.

  Also: a field scrolled to in the phone's module editor no longer lands 96px
  down the pane. That clearance exists for a column running up under the floating
  top bar, and the phone's pane already starts below everything covering it.

- [#693](https://github.com/valbuild/val/pull/693) [`1ddf245`](https://github.com/valbuild/val/commit/1ddf245ec73ad5af8099c3d18d4d33c6a1cc1254) Thanks [@freekh](https://github.com/freekh)! - The preview notice says one thing, and the setup instructions are always reachable

  The bar over the canvas used to say "Preview is not ready yet" _next to_ the
  button that makes it ready, which reads as two problems rather than one act —
  and the sentence said less than the button did. Where there is a fix, the
  button is now the whole of the message. The diagnosis ("Preview mode is off",
  "No answer from the page") comes back beside it once the twenty-second wait is
  up, because by then the button has been there without working and which way it
  is failing is the useful part. Turning preview mode on said so twice, with two
  spinners; it says so once.

  The developer's setup checklist was behind Details, and only offered where the
  page never answered — which withheld it from exactly the person who needs it:
  press the button, land back on "preview mode is off", and that was the one
  state with no route to the setup help. It is now offered in every state the
  canvas is not working in, still folded away.

  Details also stops keeping the pill's silence. The pill withholds a diagnosis
  for the first stretch because it appears without being asked for, over a page
  that is very often just compiling. The panel was opened on purpose, so it says
  what is known straight away.

  The On page view's empty card no longer explains preview mode a second time. It
  says what it is ("Nothing reported yet") and points at the one place that has
  both the reason and the button.

- [#693](https://github.com/valbuild/val/pull/693) [`a19997a`](https://github.com/valbuild/val/commit/a19997a542e65cc1375837b1bdb11c8af9e10160) Thanks [@freekh](https://github.com/freekh)! - The preview's two views are now called "Structure" and "On page"

  They were "Normal" and "Fields", and neither said what it held. "Normal" said
  only that the other one was not; "Fields" is what both of them are made of. The
  difference between them is scope — **Structure** is everything in the module
  you are editing, laid out as the content is built, and **On page** is the
  fields the running page reported having on it — and the labels were the one
  place a reader could have learned that and did not.

  On a phone the three modes now read Structure · On page · Preview. Nothing else
  changes: the `canvas-view=normal|fields` parameter is unchanged, so links
  already copied out of the Studio still open the view they were copied from.

- [#693](https://github.com/valbuild/val/pull/693) [`76c5d41`](https://github.com/valbuild/val/commit/76c5d41c3afa7cc8180d156c9e19fb082af7fba4) Thanks [@freekh](https://github.com/freekh)! - The editor's heading is compact when the canvas is open

  Beside the preview the editor is one of three panes that begin on the same
  line, and the other two start using their space immediately: the address bar is
  a control you type in, the On page header is a count and a filter. The module
  heading spent 124px before the first field to say one short name — a 24px title
  with 16px of padding over it and a 24px gap under it — which next to those does
  not read as a heading with presence. It reads as a pane that has not loaded yet.

  It is now 80px there: the same three lines (title, subtitle or route, scope),
  the same fixed height whatever a developer wrote, the same square thumbnail —
  scaled down, 24 + 16 instead of 32 + 20, with the padding above and the gap
  below following. With the canvas closed the editor is alone on the screen and
  nothing changes; the heading leads, as it should.

- [#678](https://github.com/valbuild/val/pull/678) [`cbfa2b8`](https://github.com/valbuild/val/commit/cbfa2b884898f1603bde8e5aa5cd9da78778101f) Thanks [@freekh](https://github.com/freekh)! - Putting a whole module back works for `.jsonValues()` records

  A `.jsonValues()` record's entries are not in the module's source: the `.val.ts`
  holds `c.json(() => import("./entry.val.json"))` per entry and the content lives
  in those files. Val already routed a patch that named an entry key into the
  right file, but a patch that replaced the **whole record** named no key — so it
  was applied as an ordinary source edit, writing over the imports that make the
  entries load at all. "Put everything back" in the history pane left such a module
  out for exactly that reason.

  A whole-record write is now expanded into per-entry ops before anything acts on
  it: an entry added, one removed, one changed, and nothing at all for an entry
  that already holds what the write says — so putting a module back does not
  rewrite every file in it. The same expansion produces the draft the Studio shows
  and the files a publish writes, so a draft cannot show one thing and publish
  another.

  Nothing that writes a patch has to know a record is `.jsonValues()`: write the
  module as if it were ordinary content, and it lands in the right files.

  "Put everything back" and "Restore this whole module" now cover `.jsonValues()`
  modules. They read each entry as it was at the commit and put the content back —
  never the recorded source, which is markers rather than content, and is now
  refused rather than written.

- [#688](https://github.com/valbuild/val/pull/688) [`003419a`](https://github.com/valbuild/val/commit/003419ab72f3069d92e67dfea931d5accc63e730) Thanks [@freekh](https://github.com/freekh)! - Typing without pausing now updates the preview, instead of everything sitting still until you stop

  Writing a sentence straight through left the rest of the Studio frozen. The page
  in the canvas, the list row naming what you were editing and the heading above
  it all kept showing the value from before you started, and then jumped to the
  new one once you stopped typing.

  It looked like the editor had lost its connection to the page, and the longer
  the sentence the worse it looked — a paragraph typed in one go updated nothing
  until the last word.

  The cause was that a field waits for a pause before writing, and fluent typing
  has no pauses in it. The gap between keystrokes at a normal writing speed is
  shorter than the wait, so every character pushed the write further away and it
  never happened at all.

  Writes are now capped: whatever you have typed goes out at least every two
  seconds, whether or not you have stopped. Typing that does have pauses in it is
  unchanged — still one write per pause, so nothing about the editing you were
  already doing gets noisier.

  This affects text, code and rich text fields.

## 0.130.0

### Patch Changes

- [#683](https://github.com/valbuild/val/pull/683) [`be1e8be`](https://github.com/valbuild/val/commit/be1e8bee673207596b3eb3d9a9886b8ade9b332f) Thanks [@freekh](https://github.com/freekh)! - The Studio's URL no longer carries a canvas position when the canvas is closed

  Every link copied out of the Studio came with `canvas-at=1.00%2C0%2C0` on it,
  whether or not the canvas had ever been opened. The workspace reports where it
  is from the moment it mounts — which it does regardless of whether it is on
  screen — and that position was written to the URL unconditionally.

  It is now written only alongside `canvas=1`, and closing the canvas takes it
  with it. Nothing about restoring a canvas changes: a link to one still carries
  its zoom and pan, and still opens on the view it was copied from.

- [#663](https://github.com/valbuild/val/pull/663) [`8425378`](https://github.com/valbuild/val/commit/8425378c315ea46b5d822f1130b633e0449ff1b0) Thanks [@freekh](https://github.com/freekh)! - A value that has not been written yet offers to create it, instead of looking broken

  Opening an array item or a record entry whose value is `null` rendered the item
  schema's fields over nothing, so every one of them reported **Not Found** — a
  column of broken fields where the truth is one fact about the value: nobody has
  written it. It now shows one **Create** button.

  A field inside an object always had this — the checkbox beside its label — but
  a value opened on its own has no such wrapper, and that is exactly what
  navigating to an entry does. Both places now agree.

  This is most visible with a record whose keys are declared by its schema
  (`s.record(s.locale(), …)` or `s.record(s.enum("a", "b"), …)`), where an entry
  nobody has written is `null` rather than absent. There the wording follows: an
  unwritten entry reads as **Not translated** in the list, and the button says
  **Write this translation** rather than Create.

  Also fixed: `Internal.resolvePath` reported a record entry that exists with a
  falsy value — `null`, but equally `""`, `0` and `false`, in any record — as a
  key the record does not have, so nothing could resolve a path to one.

- [#682](https://github.com/valbuild/val/pull/682) [`7d13dbc`](https://github.com/valbuild/val/commit/7d13dbced9ea49d8243b6b6cf9854cd1a259501f) Thanks [@freekh](https://github.com/freekh)! - Rename a page from the Pages panel

  The site map's per-row Duplicate button is now a **…** menu with two items:
  **Duplicate**, unchanged, and **Rename** — which changes the page's URL and
  rewrites every field that pointed at the old one, so nothing is left linking to
  a URL that no longer exists.

  Renaming asks the same question duplicating does — which URL — so it opens the
  same form, prefilled with the page's own URL and refusing both the URL it
  already has and one another page has taken.

  Both entry points to a rename (a row here, and the **Change URL** control on
  the page's own toolbar) now go through one implementation, so they cannot come
  to disagree about what renaming a page means.

- [#684](https://github.com/valbuild/val/pull/684) [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75) Thanks [@freekh](https://github.com/freekh)! - Stop telling people to run `val login` where a personal access token cannot be used

  A PAT is read from a file in the _server's_ working directory, and only local
  `fs` mode has one. `resolveRemoteFileAuth` knew that; two things upstream did not.

  `RemoteFilesErrorDialog` was unconditional. Whatever went wrong with remote files,
  it said "Personal access token file required" and told the reader to run a command
  in their project root — for a server with no working directory, a directory that
  does not exist, to produce a file it could not read. The reason was already on the
  error object and simply never looked at. The dialog now shows only for the two
  reasons a PAT can actually fix, and everything else gets its own message.

  `resolveRemoteFileAuth` also answered `project-not-configured` for a non-fs mode
  with no api key, which is wrong twice: the project may be configured perfectly
  well, and it is the credential that is absent. It answers `api-key-missing` now,
  already in the wire contract, and that message no longer says "production mode",
  because every server that is not local dev gives it.

- [#681](https://github.com/valbuild/val/pull/681) [`07db94c`](https://github.com/valbuild/val/commit/07db94c23b73c8c0b2b50a30a89926823c2da1d6) Thanks [@freekh](https://github.com/freekh)! - Editing one field of a gallery entry no longer groups the whole module as one change

  Typing alt text on an `s.imageset()` entry logged **Could not resolve path while
  creating patch set: Cannot perform op: 'add' on non-array or non-record schema.
  Type: object** on every keystroke, and collapsed the entire media module into a
  single patch set. Staging any one change in that module then dragged every other
  change in it along — the upload, and every keystroke of every other entry's alt
  text — because a patch group has to contain a prefix of each patch set it
  touches.

  The patches themselves were fine. `add` on an object key is create-or-set, and
  the Studio writes `add` rather than `replace` on purpose so the write survives
  the key having gone away in the meantime; it was the grouping that did not know
  that an object is keyed. Objects are now classified like records and settings
  sections: the change affects the key it names, and nothing else.

  A path that genuinely no longer fits its schema — a stale patch written before
  the schema changed — still falls back to grouping the whole module, which is the
  conservative answer when we cannot say what a change affects.

- [#679](https://github.com/valbuild/val/pull/679) [`473a185`](https://github.com/valbuild/val/commit/473a185f70351b44388f3bc1852649e2c1dbe001) Thanks [@freekh](https://github.com/freekh)! - `.preview()` now names a value wherever the Studio shows it, including a module's own root

  Wherever the Studio shows a piece of content to a human it has to answer three
  questions: what is this called, what is it, what does it look like. Every
  surface answered them itself, out of the path, and they disagreed — the same
  record entry read `blog1` in the heading, "Blog 1" in the scope trail and
  `/blogs/blog1` in the sitemap. They now give one answer, and it is the one you
  wrote:

  ```ts
  s.record(
    s.object({ title: s.string(), author: s.string(), cover: s.image() }),
  ).preview((blog) => ({
    title: blog.title,
    subtitle: blog.author,
    image: blog.cover,
  }));
  ```

  That title, subtitle and image are what the heading, list rows, search hits,
  cards and chosen references show. Nothing is required: a project with no
  `.preview()` reads exactly as it did — the route, the key, `[#3](https://github.com/valbuild/val/issues/3)`, or the
  prettified file name — so this is somewhere to improve from rather than
  something to adopt.

  **`.preview()` on a module's own schema now works.** It was accepted and never
  run: a preview was only ever reified by a CONTAINER for its rows, and a module
  root has no container. So `c.define("/content/authors.val.ts", s.record(…)
.preview(…), …)` can name the module itself — "Forfattere" rather than
  `authors.val.ts` — and the same is true of a field of an object.

  **A page's URL is carried separately from its title.** A route is not a worse
  name for a page, it is the page's identity: two drafts both titled "Launch" are
  told apart by `/blog/launch-2026` and by nothing else. Title a page with
  `.preview()` and its route moves to the line under the heading rather than
  disappearing.

  Two things a preview is deliberately NOT used for, because a preview is a
  closure over source and so changes as an editor types:

  - The breadcrumb, the Explorer and the Pages tree stay path segments. A trail
    of titles names three things and locates none of them. The one exception is a
    page, whose trail is its ROUTE instead of the file it is stored in — nobody
    reaches a page through the file.
  - Help text. `.describe()` is input help and is shown where a field or a key is
    being ENTERED; a record key's description no longer appears in the heading,
    where the key cannot be edited, and appears in every form that asks for one.

  Also fixed: a just-uploaded image stayed blank until save in list rows, headings
  and reference dropdowns, which built the URL of the published file rather than
  the pending patch's.

- [#677](https://github.com/valbuild/val/pull/677) [`64f0de3`](https://github.com/valbuild/val/commit/64f0de339b8621cb5a6c422dfe55cae5b2bbe2a0) Thanks [@freekh](https://github.com/freekh)! - A guided tour of the Studio, and a `studio.tour` setting to turn it off

  Editors kept asking what Pages, Media and Data are for. The three words are
  precise inside Val and vague everywhere else, and the Studio said each of them
  in three places — the rail tooltip, the panel header, the empty state — without
  ever defining any.

  **A guided tour**, offered by a glowing "Take a tour" button on the empty editor
  at `/val/~` and kept permanently in **Quick actions**: welcome, then Pages, Media
  and Data where the project has them, then the assistant where there is one, then
  Review, Preview and Publish. It never opens itself, and the glow stops for good
  once somebody has been through it on that browser.

  Turn it off for the whole project under **Settings → Studio** — a new
  `studio.tour` field on `s.settings()`, unset meaning the tour is offered. A team
  that finds it noisy switches it off once, for everyone, instead of each person
  dismissing it on each machine; the tour stays in Quick actions for anyone who
  wants it.

  Also, for the same first-run problem:

  - **Rail tooltips carry a definition** under the label: "The pages of your site,
    by URL", "Shared images and files, uploaded once", "Content that is not tied
    to one page".
  - **The empty editor is a short glossary** of the destinations this project
    actually has, rather than "No item selected".
  - **Empty states explain instead of reporting.** "No pages yet" now says who
    creates the routes pages go under; "No galleries yet" says what a gallery is
    for.
  - **A project with a single media gallery opens it**, so Media shows media
    instead of one collapsed row named after a module file.
  - **A site map of twenty pages or fewer arrives open.** With a home page at `/`
    the whole site nests under one root row, so Pages used to show a single row
    called Home. Larger sites keep the old behaviour.
  - **Settings points at Account** for the per-person settings — the theme, and
    how the Studio behaves on this machine.
  - Page rows with children now carry `aria-expanded`, as the media panel's rows
    always did.

## 0.129.0

### Minor Changes

- [#655](https://github.com/valbuild/val/pull/655) [`7d34ecc`](https://github.com/valbuild/val/commit/7d34ecce787a0709025ae7b4764cb6c3ad1f766b) Thanks [@freekh](https://github.com/freekh)! - A project can now make Val Studio look like its own.

  `s.settings()` has a new `theme` section, edited under **Settings → Appearance**
  in the Studio. It is content like everything else: edited as a draft, shown in
  the publish diff, and the same for everyone working on the project.

  ```ts
  export default c.define("/settings.val.ts", s.settings(), {
    theme: {
      accent: "#2563eb",
      radius: "tight",
      mode: "light",
    },
  });
  ```

  **`accent` is one hex, and it restyles the whole chrome** — Publish, the active
  rail item, focus rings, switches, the caret in a rich text field, and the
  outlines the canvas draws around editable elements on your own page. Any colour
  is allowed, not a list of approved ones, because what the accent replaces is a
  ten-step ramp that is _generated_ from it: each step keeps the lightness of the
  step it replaces and changes only the hue. WCAG contrast is almost entirely a
  function of lightness, so every foreground/background pair the chrome renders
  stays at AA — which is asserted across the hue circle, pure black and a
  saturated yellow included, rather than argued for. One value drives both light
  and dark mode, since the semantic tokens pick different steps of the ramp in
  each.

  **`radius`** is `square`, `tight`, `default` or `soft`, and moves every corner
  in the Studio.

  The accent also moves the outlines the canvas draws around editable elements on
  your own page. Those are drawn inside your document, which has none of Val's
  stylesheet, so the colour is sent to the page over the canvas protocol — which
  means a project on an older `@valbuild/next` or `@valbuild/tanstack` than its
  Studio keeps Val's green there until it upgrades, rather than breaking.

  **`mode`** is the mode the Studio opens in for an editor who has never picked
  one. It never overrides an editor who has — that choice stays theirs, per
  person and per browser, behind the account button.

  Every field is optional, and unset means Val's own look, so an existing
  settings module needs no change.

  Two smaller fixes that came with it:

  - **A settings change is its own entry in the publish diff.** Editing the
    assistant's tone used to collapse the entire settings module into one change
    card labelled "Settings", because the patch that writes a settings field is
    an `add`, and `PatchSets` had no case for a settings section — so it gave up
    and grouped the whole module. Two unrelated settings edits now show as two
    changes, each under the name the panel gives it.
  - **The Val mark keeps its green.** It named a step of the brand ramp, so it
    would have recoloured along with a project's accent. It has its own token now.

- [#657](https://github.com/valbuild/val/pull/657) [`0c351c4`](https://github.com/valbuild/val/commit/0c351c4f97ae7f09772eab0e856ae69821b803b7) Thanks [@freekh](https://github.com/freekh)! - A project can put its own logo in Val Studio.

  `s.settings()`'s `theme` section takes a `logo`, uploaded from **Settings →
  Appearance**. It replaces Val's mark at the top of the left rail, and beside the
  menu button below the desktop breakpoint — the two slots that say which
  workspace you are in.

  ```ts
  export default c.define("/settings.val.ts", s.settings(), {
    theme: {
      logo: {
        path: "/public/val/brand/mark_a1b2c.png",
        width: 512,
        height: 512,
        mimeType: "image/png",
      },
    },
  });
  ```

  It is an ordinary image field, so it comes with the upload, the alt text and
  everything else `s.image()` has, and the file lands in `/public/val/brand` so it
  does not sit in the middle of your content's media. A draft logo shows
  immediately and publishes with the rest of your changes.

  Two things are deliberate:

  - **A square-ish mark, not a wordmark.** The slot is 32px wide. A wide image is
    fitted into it rather than cropped, so all of it is there and none of it is
    large.
  - **Val's mark stays on the launcher that floats on your own site.** In the
    Studio the mark labels the workspace, so your logo belongs there. On your own
    page it labels the tool — it is the button that opens Val — and your logo
    floating over your own website says nothing.

- [#656](https://github.com/valbuild/val/pull/656) [`41a0d76`](https://github.com/valbuild/val/commit/41a0d76636a2dce3f1e506d93170d97e46041d98) Thanks [@freekh](https://github.com/freekh)! - Tone of voice comes first in the assistant's settings, and an empty one can
  write itself.

  **Generate from my content** appears on Tone of voice while it is empty. It asks
  the assistant to read a spread of what the project has already published and
  describe how it is written — sentence case or title case, British or American,
  how formal, whether it uses exclamation marks — and then write that into
  `assistant.tone`.

  It goes through the ordinary assistant rather than a new endpoint, and that is
  worth knowing because of what it means for you: the conversation shows which
  modules it read and what it concluded, the answer arrives as a draft you can
  edit or discard like any other change, and "shorter" or "we are not that formal"
  is just the next message.

  The button is only offered while the field is empty — with something in it, a
  button that regenerates is a button that loses what you wrote, and a settings
  panel has no undo. Clear the field to ask again.

  Also: Context now sits below Tone of voice, which is the order you fill them in.

  Two accessibility fixes in the same panel, both from these fields being wrapped
  in a `<label>`:

  - A button inside a label takes the LABEL's accessible name, so the new one
    would have been announced as "Tone of voice, button".
  - Everything inside a wrapping label names the control, so each box was
    announced with its whole help text as part of its name. The description is
    `aria-describedby` now, and a validation message goes there too.

### Patch Changes

- [#670](https://github.com/valbuild/val/pull/670) [`e20f6fb`](https://github.com/valbuild/val/commit/e20f6fbcc215c310eef49a44c1a592c1e2081613) Thanks [@freekh](https://github.com/freekh)! - Global search no longer offers route patterns as pages

  Searching (⌘K) listed a row for every node in the site map, including the rows
  that are only path segments. `/blogs` is in the site map because
  `/blogs/blog-1` is; it has no content of its own, and the only URL it has is
  the route PATTERN its children share. So the second row of the search in a
  project with an `/app/blogs/[blog]/page.val.ts` was `/blogs/[blog]` — a page
  that does not exist.

  Selecting it made that concrete. Such a row has no source path, so
  `findShellSelection` could not resolve it, and the fallback — which exists for
  content hits, whose id IS a source path — took the row's id (the pattern) and
  navigated to it, landing the Studio on `/val/~/blogs/[blog]`.

  These rows are now skipped when the search rows are collected, and their
  children are still walked, so the pages under a folder are found as before. The
  Pages panel is unchanged: there a folder row expands, which is what it is for.
  The fallback is now taken only for the two kinds of row whose id is a source
  path, so an unresolvable navigation row does nothing instead of navigating
  somewhere that is not there.

- [#672](https://github.com/valbuild/val/pull/672) [`9e0ebb0`](https://github.com/valbuild/val/commit/9e0ebb00430f05ef92dff031309f73b8075a7d99) Thanks [@freekh](https://github.com/freekh)! - Republish the Studio so it reads `dir`, the key `@valbuild/core` now serializes.

  0.128.0 renamed the media schema option `directory` to `dir`, and that rename
  reaches the serialized schema the Studio reads. `@valbuild/ui` was not
  republished with it — it declares `@valbuild/core` and `@valbuild/shared` as
  devDependencies, so changesets did not see it as a dependent — and
  `@valbuild/server`, `@valbuild/next`, `@valbuild/react` and `@valbuild/tanstack`
  all pin `@valbuild/ui` exactly. So 0.128.0 shipped a Studio built before the
  rename, reading a key that core no longer emits.

  Two things broke for anyone on 0.128.0, both silently:

  - **Uploads landed in the wrong directory.** `ImageField` and `FileField`
    resolve where a file goes from `options.dir` or, for a gallery-backed field,
    the gallery's `dir`. Reading the old key gave `undefined`, so every upload
    fell back to `/public/val` — outside the directory the schema names, which
    then fails validation. This is the same failure the example app records as
    previously fixed.
  - **The Media nav lost its labels.** Galleries are listed and sorted by their
    directory; with the old key that fell back to the module path, so every
    gallery was labelled by file rather than by the directory an editor thinks in.

  Nothing in the Studio's source changed here — 0.128.0 already had the correct
  code. This publishes it.

## 0.127.0

### Minor Changes

- [#608](https://github.com/valbuild/val/pull/608) [`7fa8699`](https://github.com/valbuild/val/commit/7fa869974bc895af992a7d5c18b76253636d7d65) Thanks [@freekh](https://github.com/freekh)! - A record whose schema declares its keys now holds every one of them.

  Two key schemas enumerate their keys: `s.locale()`, whose set is the project's
  `locales.available`, and a union of literals. For those, the keys are part of the
  schema, so a missing one is a hole in the content rather than content nobody has
  written yet — and validation now says so, naming what is missing.

  ```typescript
  s.record(s.locale(), s.object({ title: s.string() }));
  // Missing key: 'nb-NO'. This record's keys are declared by its schema, so
  // every one of them is an entry — an entry nobody has written yet is null,
  // not absent.
  ```

  **An entry nobody has written yet is `null`.** Not an absent key: a null entry is
  data you can count, filter and see in a diff, and it means half-translated
  content stays _valid_ rather than blocking a publish. The value type of such a
  record widens by `null` to match, so writing one in a `.val.ts` type-checks:

  ```typescript
  c.define(
    "/content/jacket.val.ts",
    s.record(s.locale(), s.object({ title: s.string() })),
    {
      "en-US": { title: "Winter jacket" },
      "nb-NO": null, // nobody has translated this yet
    },
  );
  ```

  **This changes `s.record(s.union(...), item)`**, and closes a gap that was
  already there: `s.record(s.union(s.literal("a"), s.literal("b")), item)` types as
  `Record<"a" | "b", T>`, so TypeScript demanded both keys while the validator only
  checked the ones present. It now checks them too, and — as above — accepts `null`
  for an entry that has not been filled in. If you have such a record with keys
  missing, validation will report them; adding the keys with `null` values is the
  fix, and creating one from the Studio does it for you.

  `emptyOf` creates these records with every key already in them rather than
  empty, since an empty one is already missing keys. In the Studio use the
  `useEmptyOf()` hook rather than importing `emptyOf` directly: a locale record's
  keys are in the settings module, and the hook is what has read it.

- [#608](https://github.com/valbuild/val/pull/608) [`600308d`](https://github.com/valbuild/val/commit/600308d0174990ad9f5c417147d160273489c65a) Thanks [@freekh](https://github.com/freekh)! - A locale filter in the Studio: work through one language at a time.

  Pick a language from the filter in the top bar — the bottom bar on a phone — and
  the Studio shows that language's content. **Content in no language at all is
  always shown**, which in most projects is most of it: the filter narrows a
  translated section rather than emptying the Studio.

  It changes what is **listed**, never what is reachable. A link to a Norwegian
  page opens that page while the filter says English, because the filter is for
  working through one language and not a permission on the content.

  The default is all locales, and it is deep-linked as `?locale=nb-NO`, so a link
  carries the view you are on. A project that has declared no languages has no
  filter at all: a picker offering only "All locales" is furniture that explains
  nothing.

  Filtering is a per-node question rather than a walk, and that falls out of the
  scope rule: only a node that OPENS a locale scope is ever filtered, and content
  inside a scope is reachable only through the node that opened it — so hiding
  that node takes its subtree with it. Two of the three ways a scope opens are
  answerable from what a list already has: an entry of a locale-keyed record (the
  key IS the language) and an object with a `locale` field.

  The filter reaches record entries, array items and blocks. A locale-keyed record
  filters its KEYS, so a row in another language is never rendered at all; every
  other row asks its own content, because a list has paths and the language is in
  the row.

  A locale field nobody has filled in stays listed. Hiding it would hide the field
  someone has to fill in to un-hide it — and a row that has not loaded yet stays
  listed too, so a list does not shed rows as it arrives.

  **While the filter is on one language, `s.locale()` fields are fixed to it.** A
  new item created under the filter arrives already set — filtered to Norwegian,
  you are writing Norwegian, and an item that defaulted to unset would fail
  validation and disappear from the list you are looking at, in that order. An
  existing field is shown but cannot be changed, with a tooltip saying why and
  naming the way out: clear the filter. Letting one field say another language
  while everything around it says this one would make the thing you are editing
  vanish as you saved it, which reads as the Studio losing your work rather than
  as a filter doing its job.

  Not yet filtered: the Pages and Data panels. A page is a tree rather than a list,
  so hiding one is a different question from hiding a row, and it is worth its own
  change.

- [#608](https://github.com/valbuild/val/pull/608) [`5b7fe05`](https://github.com/valbuild/val/commit/5b7fe05cec6365f9cd1de9ba31e65ed4a87edb63) Thanks [@freekh](https://github.com/freekh)! - `s.locale()`: one of the project's languages.

  The languages themselves are declared in the settings module (`locales.available`);
  this says that a value is one of them.

  ```typescript
  // a field: everything in this entry is in this language
  s.record(s.string(), s.object({ locale: s.locale(), title: s.string() }));

  // a key: one entry per language
  s.record(s.locale(), s.object({ title: s.string() }));
  ```

  Every locale in content is checked against the project's list, the way `keyOf`
  and `route` are checked against what they point at. An undeclared language names
  the ones the project has; a project that has declared none is told to declare
  them rather than told the value is wrong.

  A locale is stored as the tag itself — the value in content is `nb-NO`, and a
  record keyed by `s.locale()` has `nb-NO` as its key. Spelling one differently
  where it is stored (`/no/…` as a URL segment) is a real need and is deliberately
  not in this release: it changes what is accepted as well as what is shown, so it
  is being designed on its own rather than folded in here.

  A locale is **never stega encoded**: it ends up in `<html lang>`, in `hreflang`
  and in `Intl` constructors, none of which survive invisible characters.

  `assistant.translation` joins the settings module alongside `context` and `tone`
  — a note per language, keyed by language, so only the target language's rules are
  sent when translating into it.

- [#608](https://github.com/valbuild/val/pull/608) [`29811c3`](https://github.com/valbuild/val/commit/29811c3f8c7e001a950e6f4833af6888e6a4efea) Thanks [@freekh](https://github.com/freekh)! - Settings: declare the languages a project publishes.

  A new `locales` section in the settings module says which languages a project
  has:

  ```typescript
  export default c.define("/settings.val.ts", s.settings(), {
    locales: {
      available: ["en-US", "fr-FR", "nb-NO"],
    },
  });
  ```

  The order is the project's own and is kept rather than sorted: it is the order
  of the Studio's locale picker and of the rows in a locale-keyed record. There
  is no default language — every locale-specific field asks which language it is
  in, and a default is the answer that lets that question go unanswered.

  Like every other settings section it is optional, so a project that is not
  translated writes nothing and sees nothing: no locale controls appear anywhere
  until `available` has something in it.

  This is content rather than configuration, and deliberately: which languages a
  site has is a decision the people who write it make, and under a build-time
  constant it took a developer and a deploy. It is the same move `assistant`
  already makes with `enabled`.

  Tags are BCP 47 (`en-US`, `nb-NO`), checked through `Intl.getCanonicalLocales` —
  the same implementation `<html lang>` and every `Intl` constructor use — and
  they have to be in canonical form. `nb-no` parses, but nothing else in the stack
  agrees it is the same string as `nb-NO`, and a locale is compared as a string
  everywhere it is used. Validation names the spelling to use, and reports a
  language declared twice on the repeat rather than on the list — that is the row
  to delete, and a message on the list itself would not say which.

  Edited under Settings → Locales in the Studio, which names each language in its
  own language.

### Patch Changes

- [#669](https://github.com/valbuild/val/pull/669) [`9983116`](https://github.com/valbuild/val/commit/99831164c5151aad7ca69de79e1d0d59878be251) Thanks [@freekh](https://github.com/freekh)! - Fix the Studio crashing with `crypto.randomUUID is not a function` when it is
  opened over plain http on something that is not `localhost`

  Opening `/val` at an address like `http://172.23.135.172:3000` — a LAN IP, a
  VM, or a dev server inside WSL viewed from a browser on Windows — left a blank
  screen and this in the console:

  ```
  crypto.randomUUID is not a function
  ```

  `crypto.randomUUID` is secure-context only: it exists on `https://` and on
  `localhost`, and is simply absent anywhere else. The Studio called it while
  rendering, to name its websocket connection, so it died before it drew
  anything. Every id the Studio generates this way now goes through a fallback
  that works in any context. `navigator.clipboard`, which is secure-context only
  for the same reason, got the same treatment — copying a code block out of the
  assistant no longer throws there either.

  The fallback is `crypto.getRandomValues`, which exists in an insecure context
  and is still cryptographically secure — which matters, because a patch id is
  what `/api/val/files` accepts instead of authentication when it serves an
  unpublished file. Where a browser has neither that nor `crypto.randomUUID`, the
  Studio now says so rather than inventing a guessable id.

  This is not specific to any framework, but it shows up most with TanStack
  Start: `vite dev` binds `localhost` only, so a WSL user who wants to see the
  site from Windows runs it with `--host` and opens the VM's IP, while `next dev`
  binds `0.0.0.0` and `localhost` keeps working.

## 0.126.0

### Minor Changes

- [#652](https://github.com/valbuild/val/pull/652) [`f2fe70d`](https://github.com/valbuild/val/commit/f2fe70dab2b65000dfaf289f09c70b4a8291467a) Thanks [@freekh](https://github.com/freekh)! - `s.union` is now `s.discriminatedUnion` and `s.enum`.

  `s.union` did two unrelated jobs and worked out which one you meant from its
  first argument: a string key meant a tagged union of objects, literal schemas
  meant a set of allowed strings. Those are now two schemas with two names.

  ```ts
  // A fixed set of strings — presents as a dropdown
  s.enum("primary", "secondary", "ghost"); // Schema<"primary" | "secondary" | "ghost">

  // One of several object shapes, told apart by a tag field
  s.discriminatedUnion(
    "type",
    s.object({ type: s.literal("hero"), heading: s.string() }),
    s.object({ type: s.literal("quote"), text: s.string() }),
  );
  ```

  `s.enum` takes the strings directly, so the `s.literal(...)` wrapper is gone.

  **`s.union` still works** — it is deprecated, and it builds exactly the schema
  above, so nothing has to change today:

  ```ts
  s.union(s.literal("one"), s.literal("two")); // → s.enum("one", "two")
  s.union("type", pageA, pageB); // → s.discriminatedUnion("type", pageA, pageB)
  ```

  The two are different kinds of node, and that is the reason for the split. A
  discriminated union is a container: the selected variant's fields are the fields
  being edited, and everything that walks a schema descends through it. An enum is
  a leaf — a string with a closed domain — so nothing recurses into it. Told apart
  only by the shape of `key`, every consumer had to re-derive which one it was
  holding; each now has its own serialized type (`"discriminated-union"` and
  `"enum"`) and Val Studio has a field per kind rather than one field that
  branches.

  Two behaviour changes fall out of the split, both of them fixes:

  - A value that is not a string at all now fails an enum's validation with a
    type error. `s.union` of literals only ever checked the value against its
    literals when the value WAS a string, so a number or an object where an enum
    was declared validated clean.
  - An enum field now shows its validation errors in Val Studio where the field
    is opened on its own — the module editor and the canvas's fields column — and
    gets the compact error layout inside an inline list row. It is a leaf now, so
    it goes through the same error rendering as every other leaf field; the string
    union bypassed it and showed nothing in those places.

  Several latent crashes in the old `s.union` are fixed on the way past, all of
  them cases where it threw a `TypeError` instead of reporting:

  - A required discriminated union holding `null` now reports a type error rather
    than throwing, and resolving a path underneath a nullable one that is `null`
    gives the error the API promises instead of a crash.
  - `s.literal("")` is a legal discriminator tag, and `s.enum("")` a legal value.
    Both used to be treated as absent by a truthiness check — in path resolution,
    in stega encoding, and in the message that lists a union's valid tags. The
    editor's dropdowns handle them too: an empty value is reserved by the select
    component and had to be mapped around.
  - A variant that omits the discriminator entirely is now reported as the schema
    error it is, instead of throwing while the check looked for it.
  - An enum's value is now indexed for search, like every other string leaf. The
    old string union was never indexed at all, so searching for one of its values
    could not find the field.
  - A nullable discriminated union set to `null` no longer renders a spinner that
    never resolves.

  `s.discriminatedUnion` also requires at least one variant, as `s.enum` requires
  at least one value: a union with nothing to select is not a thing to write, and
  everything downstream reads the first variant where it needs any.

  If you read serialized schemas yourself, that is the breaking part: `type` is no
  longer `"union"`, an enum carries `values: string[]` instead of a `key` plus
  `items` of literal schemas, and `UnionSchema` is no longer a class.
  `SerializedUnionSchema`, `SerializedStringUnionSchema`,
  `SerializedObjectUnionSchema` and `UnionSchema` remain as deprecated type
  aliases.

### Patch Changes

- [#664](https://github.com/valbuild/val/pull/664) [`719ad6b`](https://github.com/valbuild/val/commit/719ad6b607bcf136d0dbde9e90bf4b8a843561a4) Thanks [@freekh](https://github.com/freekh)! - Recent activity now shows publishes, not just edits

  The Studio's Recent activity list only ever showed unpublished edits. Publishes
  lived in the status bar's deploy feed, which is a live-progress indicator — it
  closes itself once a build lands, and rows can be dismissed — so as soon as a
  publish had finished, nothing in the Studio said it had.

  Publishes are now rows in the same list, interleaved with the edits by time, so
  the panel reads as what happened here: you changed the hero, it went out, a
  colleague changed the pricing. A publish row carries the commit message (or the
  short sha when there is none), who published it, and how the build is doing —
  with the same labels and the same spinner/warning icons the deploy feed uses, so
  one publish never reads two ways in two places.

  Edits stay clickable and open the field they changed; a publish is a commit and
  opens nothing, so it renders as a line rather than a button. Publishes take at
  most three of the eight rows: an afternoon of publishing must not push out the
  edits the panel exists to get you back to, and the full feed is still in the
  status bar.

- [#664](https://github.com/valbuild/val/pull/664) [`9830277`](https://github.com/valbuild/val/commit/9830277e9aaca8da3030f629c2656ec58da47e45) Thanks [@freekh](https://github.com/freekh)! - "All changes saved", not "All changes saved locally"

  The status bar's resting state claimed changes were saved _locally_, at every
  breakpoint and in both modes. Against a project that is wrong: the patch is on
  the content service, which is where it has to be for a colleague to see it and
  for Publish to ship it. "Locally" reads as "still only on this machine" — the
  one thing an editor would want to know, said backwards.

  It is not worth saying in local dev either, where the bar already shows "Dev
  mode" and the branch a couple of items to the left.

- [#664](https://github.com/valbuild/val/pull/664) [`64bfd0a`](https://github.com/valbuild/val/commit/64bfd0a6c85832ea5169b53e47087f22e193df36) Thanks [@freekh](https://github.com/freekh)! - The canvas no longer covers the page to say preview mode is off

  Whenever the canvas could not do its job, a panel with a blurred backdrop
  covered the whole frame. That stopped the canvas being a canvas: the published
  page underneath is real and worth reading and scrolling, and none of it was
  reachable behind an explanation of why it could not be _edited_. And because
  the panel also appeared during ordinary slowness — a first `next dev` compile of
  a route, the enable redirect in flight — the normal path to a working canvas ran
  through a screen that looked like a failure.

  It is a small pill at the top of the canvas viewport now, with the page
  untouched behind it. For the first twenty seconds it shows a spinner and says
  only that the preview is not ready yet; after that it turns into a warning, with
  warning colours, and names what is actually wrong — "Preview mode is off" or "No
  answer from the page".

  "Turn on preview mode" is on the pill itself, as soon as there is something to
  turn on — it is the one thing most people here need, and it is one click. The
  explanation, "Reload" and the developer's setup checklist are behind a "Details"
  disclosure, so nobody has to read a wiring guide to look at their page.

- [#664](https://github.com/valbuild/val/pull/664) [`7782979`](https://github.com/valbuild/val/commit/7782979e9b52f2015a6e72dc981e630d4f8c78e2) Thanks [@freekh](https://github.com/freekh)! - The deploy feed is the last few publishes, with no rows to dismiss

  Every row in the deploy list carried a dismiss button, and the shell and the
  provider each kept a set of dismissed commits to subtract from the feed. That
  control existed because the list grew: the client accumulated every deployment
  and commit a session had ever seen, so a tab left open all day ended up with a
  list only clearing could shorten.

  The feed is bounded now — the content service returns the most recent publishes,
  and the client keeps the newest few of those — so there is nothing to tidy: what
  a row would be dismissed for is that it is old, and being old is what takes it
  off the end of the list on its own. The list still closes on its own once
  everything has landed, on Escape, and on a click outside.

  One behaviour follows from the feed carrying history: the list no longer opens
  itself for an old publish. It used to treat anything Val had not seen serving
  the site as news, which was true when the feed only held the publishes on the
  current chain — now that it holds the last few, "not live" is the resting state
  of every publish that has been superseded, and opening Val would have announced
  a build from last week. Freshness decides it instead.

- [#664](https://github.com/valbuild/val/pull/664) [`5bfd630`](https://github.com/valbuild/val/commit/5bfd630b63dee2189e238f20fe72ecc5537160f7) Thanks [@freekh](https://github.com/freekh)! - Show the git message on deployments Val did not publish

  The deploy feed could only name a publish when Val itself had made the commit:
  the message came off Val's own `ValCommit`, and every other deployment — a
  developer's push, a merged pull request, a revert — showed a seven-character
  sha. On most projects those are the majority, so "what went out at 14:02?" had
  no answer in the Studio.

  A deployment can now carry its own `commitMessage`, which the Studio uses
  wherever there is no Val commit to prefer. It is optional and nullable, so a
  content service that does not report messages is unaffected — those publishes
  keep showing the short sha, exactly as before.

  Deployment rows also show only the subject line of a message now. A git message
  is a subject, a blank line and a body, and the rows are one truncated line — so
  a real push arrived as "Subject The body went on like this…". The classic
  Draft changes view still has the whole message in its tooltip.

- [#659](https://github.com/valbuild/val/pull/659) [`ccbcda6`](https://github.com/valbuild/val/commit/ccbcda60b3e3c465071229ae1ba28ac735483e63) Thanks [@freekh](https://github.com/freekh)! - Discarding changes now clears the validation errors, previews and search results
  that were computed from them.

  A discard that removed a module's last pending change announced itself only as
  a "drop", and the stores that keep validation results, previews and the search
  index listened only for changes being applied. So after discarding, the Studio
  kept showing the errors and previews of the discarded edit until something else
  touched the module.

  Fields that reference another module's keys (`s.keyOf(...)` and `s.route()`)
  also follow that module now. Renaming a page and then discarding the rename left
  every `keyOf` field pointing at it reporting that the key does not exist — about
  a key that was back — because the module holding the reference had not changed
  and was never re-checked. The validation store now tracks which records a
  module's errors resolve against and re-checks it when their keys change, and only
  then: editing content inside a referenced page does not re-validate its
  referrers.

- [#667](https://github.com/valbuild/val/pull/667) [`755e1a3`](https://github.com/valbuild/val/commit/755e1a3953775cb8d2c2dce87d6810d3dc329640) Thanks [@freekh](https://github.com/freekh)! - An empty image description is no longer marked as an error

  The Description field of an image field showed a red **Missing** next to it
  whenever it was empty. Val has no rule that alt text is required, so nothing in
  validation reports that — the badge claimed an error the validator never
  raises, on every image field that had not been given a description. It is gone.
  If a schema ever does require alt text, that arrives through the ordinary
  validation error path, which the field already shows.

  The **Use the filename** shortcut next to it is gone with it. It only ever
  appeared alongside the badge, and a filename says what the file is called
  rather than what the picture shows, which is the one thing the field is asking
  for.

- [#660](https://github.com/valbuild/val/pull/660) [`c6b1ec8`](https://github.com/valbuild/val/commit/c6b1ec84f1883750a4cfe5f70470b177621e971f) Thanks [@freekh](https://github.com/freekh)! - Surfaces in the Studio paint the colour they name

  Four places named a colour from shadcn's compatibility block — `bg-card`,
  `bg-primary-foreground`, and a gradient's stops. None of those tokens is
  declared anywhere the Studio can see them: they live under `:root` and `.dark`,
  and the Studio renders inside a shadow root (where `:root` matches nothing)
  with `darkMode` set to `[data-mode="dark"]` (so `.dark` never matches either).

  The effect is quiet, which is why it lasted: an undefined colour is invalid at
  computed-value time, so the element simply paints nothing and shows whatever is
  behind it. The record list's rows had no background at all, and the fade over a
  truncated list row computed to a gradient from transparent to transparent —
  no fade.

  They now name the Studio's own tokens. Nothing changes colour: each surface was
  already showing the page background through the hole, which is the colour it
  now paints deliberately — except the truncation fade, which appears again.

  `surfaceTokens.test.ts` holds the line, alongside the focus-ring test that
  covers the same trap for `box-shadow`. It reads the dead tokens out of
  `index.css`, so reviving one lifts the ban on it automatically. The vendored
  `components/designSystem/` copies of shadcn are out of scope and still name the
  dead tokens.

- [#664](https://github.com/valbuild/val/pull/664) [`656f680`](https://github.com/valbuild/val/commit/656f680043c640f678625a64e690389ab23a0a69) Thanks [@freekh](https://github.com/freekh)! - Move the assistant button to the bottom bar on mobile

  On a phone the Sparkles button sat in the top right of the top bar, sharing
  that corner with the navigation menu, History, notifications and the account
  avatar — the furthest point on the screen from a thumb, and the row you reach
  for least.

  It is now in the sticky bottom bar, beside Quick actions, where Preview and
  Publish already are. The top bar drops its own button below the mobile
  breakpoint, so there is still exactly one way in rather than two places to look
  for the same panel. Nothing changes on tablet or desktop, and a project with no
  assistant configured shows no button in either place.

- [#664](https://github.com/valbuild/val/pull/664) [`610a041`](https://github.com/valbuild/val/commit/610a0414b120b521f38a2eb1182b3778bf778b2b) Thanks [@freekh](https://github.com/freekh)! - Review stays in the top bar with nothing pending, and says so

  Above the mobile breakpoint — a phone reaches Review through Quick actions, and
  still does — the Review button was hidden whenever nothing was pending: present
  in the layout so the bar would not reflow, but unreachable and invisible to
  screen readers. That made "is anything of mine still unpublished?" unanswerable from
  the top bar: a hidden button and a button whose data has not loaded yet look
  exactly the same, so the only way to find out was to publish and see what
  happened. The Quick actions row on a phone already answered it; the bar now
  does too.

  Opening it with nothing pending gives a real screen instead of the single grey
  "No pending changes." line: it says the editor and the published site agree, and
  what the view will show once they do not. The wording follows the mode, so a
  local dev project is told about its working tree rather than about publishing.

  The change count is still a badge that only appears when there is one, so an
  empty Review reads as "nothing pending" rather than as "0 changes".

## 0.125.0

### Minor Changes

- [#638](https://github.com/valbuild/val/pull/638) [`c390397`](https://github.com/valbuild/val/commit/c390397cb5e203eb1bedae3a6fab15726e850b90) Thanks [@freekh](https://github.com/freekh)! - Val now runs on TanStack Start.

  `@valbuild/tanstack` is a new package with everything `@valbuild/next` has: Val
  Studio at `/val`, the on-page overlay and canvas, draft mode, the client hooks,
  server-side content reads, images, and the MCP tools.

  ```sh
  npm install @valbuild/tanstack
  ```

  ```ts
  // val.config.ts
  import { initVal } from "@valbuild/tanstack";
  const { s, c, config, tanstackRouter } = initVal({ project: "org/project" });
  ```

  **Routes are first class.** A Val module for a route is named after the route
  file it sits beside — `src/routes/posts.$postId.tsx` is served content by
  `src/routes/posts.$postId.val.ts` — and its keys are the URLs that route serves:

  ```ts
  export default c.define(
    "/src/routes/posts.$postId.val.ts",
    s.router(tanstackRouter, s.object({ title: s.string() })),
    { "/posts/hello-world": { title: "Hello world" } },
  );
  ```

  `.` and `/` both separate segments, `$param` is a parameter, `$` is a splat, and
  `index`, `route`, `(groups)` and `_pathless` layouts add no URL segment — the
  same rules TanStack Router uses for the route file itself. Val validates every
  key against that pattern, and Val Studio shows these modules as a sitemap under
  **Pages**, where an editor can add a page.

  Point the route generator away from your content files, in `vite.config.ts` and
  `tsr.config.json`:

  ```ts
  tanstackStart({ router: { routeFileIgnorePattern: "\\.val\\.[tj]sx?$" } });
  ```

  See the [README](https://github.com/valbuild/val/blob/main/packages/tanstack/README.md)
  for the full wiring, and `examples/tanstack` for a working app.

  **Also fixed, for everyone:** `Internal.VERSION.core` was `null` in any ESM
  bundle — it was read with `require("../package.json")` inside a `try`, so the
  failure was silent. That version goes into every remote file ref and proxy mode
  refuses to start without it. Every package now reads its version through a
  static JSON import, which is inlined at build time.

  Two smaller fixes that came out of running the whole toolchain against a
  TanStack project:

  - `val versions` reports `@valbuild/tanstack`, and `val debug` writes a snapshot
    that names whichever framework package the captured project actually has.
  - `@valbuild/eslint-plugin` reads a `tsconfig.json` that has comments in it. A
    tsconfig is JSONC, and `JSON.parse` is not — so on any project whose tsconfig
    carries a comment (the TanStack starter's does) the
    `module-in-val-modules` rule threw `Expected double-quoted property name in
JSON` on the first file and took the whole lint run with it.

  Three fixes found by driving the Studio against a real TanStack app:

  - **A draft image now loads on the page.** The source the Studio pushes to the
    host page carries `patch_id` for any file whose bytes are still in a patch, so
    the page asks `/api/val/files/...?patch_id=` rather than a `/public` path that
    nothing has written yet. This was silent — the image just did not appear — and
    it affects any page that reads media through the hooks rather than on the
    server, `@valbuild/next` included.
  - **A splat route no longer logs an error on every render.** TanStack returns
    both `_splat` and `*` for the same parameter; Val reported the second as a
    parameter it could not place in the path.
  - The TanStack example and starter render a 404 page instead of throwing
    `notFound()` from a component, which escaped to the error boundary and logged
    `Error in renderToReadableStream` (and, with no not-found component
    configured, aborted the response) on every miss.

## 0.124.0

### Minor Changes

- [#635](https://github.com/valbuild/val/pull/635) [`5674237`](https://github.com/valbuild/val/commit/56742371a75b4fdcbff8b1afccff8fcc1ebf8078) Thanks [@freekh](https://github.com/freekh)! - Find your history from the Studio, instead of building a URL by hand

  The two-pane history view shipped with no way in. Everything behind it worked —
  the commit archives, the reconstruction, the compare, the restore — but the
  only way to reach it was to read a commit sha out of the database and assemble
  a query string yourself. A feature nobody can find is not shipped.

  There is now a **History** button in the top bar, next to Publish. It lists what
  has been published on this branch, newest first, with the message, who published
  it, when, and how many changes it carried. Click one and it opens beside the
  Studio; **Stop comparing** closes it again.

  - Commits made before Val recorded history — and ones pushed straight to the
    repo — are listed, but greyed out and not clickable, with a note saying why.
    Hiding them would make your history look shorter than it is.
  - **Load more** pages back through older commits.
  - The button does not appear in local development, where there is no published
    history to list.

- [#639](https://github.com/valbuild/val/pull/639) [`ad7fff4`](https://github.com/valbuild/val/commit/ad7fff4cc8cea98c506cf7ff9b4e8d6e5ffa4055) Thanks [@freekh](https://github.com/freekh)! - Show `.jsonValues()` entries in the history pane

  A `.jsonValues()` record keeps each entry's content in its own `*.val.json`
  file; the module's own content is just markers pointing at them. The history
  pane had no way to fetch those files for a past commit, so every entry rendered
  as an **empty field** — which reads as "the author left this blank", about
  content that was simply stored somewhere else.

  Entries now load in the history pane the same way they load in the Studio: one
  at a time, when you open one. A commit with a thousand support pages costs
  nothing until you look at one of them.

  An entry that cannot be read says so instead of rendering blank — including the
  case where the key did not exist yet at that commit, which is a real answer
  rather than an error.

## 0.123.3

### Patch Changes

- [#634](https://github.com/valbuild/val/pull/634) [`356eb11`](https://github.com/valbuild/val/commit/356eb11b5f6a0a02dfec80580c6fccac75d28402) Thanks [@freekh](https://github.com/freekh)! - Publish the AI summary that arrived while you were waiting for it

  Pressing Publish while the AI was still writing the commit message starts a
  short countdown, so the summary gets a chance to land before the commit goes
  out. It landed — the box on screen filled with it — and then the commit said
  "Update Home" anyway.

  The text was read back out of the summary state by the publish button, from
  that button's own render. The countdown fires a callback created when Publish
  was pressed, and applying the summary and ending the wait happen in the same
  flush, so the callback always ran with the text the box held _before_ the
  summary arrived. No amount of waiting could have fixed it.

  The popover now hands the text to publish along with the request, and works it
  out from the values as they are at that moment. The rule is unchanged and is
  still the one thing this flow guarantees: an AI summary takes over only a box
  nobody has typed in, so anyone who wrote their own summary publishes exactly
  what they wrote, whenever the AI happens to answer.

## 0.123.2

### Patch Changes

- [#630](https://github.com/valbuild/val/pull/630) [`3e93508`](https://github.com/valbuild/val/commit/3e93508b05d08b0c24947a97c6141a9ad8a3931e) Thanks [@freekh](https://github.com/freekh)! - Two fixes to the Studio's chrome

  **Data, Media and Settings are reachable again on a tablet.** The left rail is
  drawn from 1200px up, and the top bar's menu button opens the first destination
  a project has and nothing else — so between 768px and 1200px, which is an iPad
  in either orientation and any half screen, whichever panel happened to be open
  was the only panel you could reach. The destination switcher that stands in for
  the rail was shown below 768px only, and the tablet width fell through the gap
  between the two. It is now shown at every width where the rail is not.

  **Review moved to the left of Preview.** The three actions read left to right
  in the order they are done in — Review, Preview, Publish — instead of putting
  the first step between the other two.

## 0.123.0

### Minor Changes

- [#613](https://github.com/valbuild/val/pull/613) [`c5e7dfd`](https://github.com/valbuild/val/commit/c5e7dfd12aa1371195be642e1c2fb72b6f3e3ce2) Thanks [@freekh](https://github.com/freekh)! - Val's MCP endpoint moves to its own package, and can now upload images

  Everything that serves Val's content tools over MCP — the tool registry, the
  write path behind it, the request guards and the access-token verification —
  now lives in **`@valbuild/mcp`** instead of being split between
  `@valbuild/server` and `@valbuild/next`.

  **Nothing changes for an app that already mounts it.** `initValMcp` is still
  exported from `@valbuild/next/server` and behaves exactly as before; it is now a
  ten-line binding over `@valbuild/mcp`, supplying the Next version that
  `initHandlerOptions` asks for. A host that is not Next can call
  `initValMcp` from `@valbuild/mcp` directly.

  If you built your own host on `createValTools`, import it from `@valbuild/mcp`
  rather than `@valbuild/server`; the tool types moved with it.

  ## Image uploads

  An agent can now add an image, with a new `upload_image` tool. It takes a path
  to a file on the machine your app runs on, or the image inline as base64, and
  puts it in an `s.image()` field or an `s.images()` gallery.

  Uploads are converted **only where the Studio would convert them**: `encode` is
  off unless the schema asks for it (`s.image({ encode: { type: "webp" } })`), and
  when it does, which images are converted, how far they are scaled and when the
  original wins are the same decisions the browser makes — the same code, now
  shared. An upload to a schema without `encode` is stored exactly as it arrived,
  whatever its size.

  One thing the tool does that the Studio does not: it refuses an image the
  schema's `accept` does not cover, checked on the bytes that would actually be
  stored. The Studio does not need to — its file picker carries `accept` — and
  validation reports a mismatch as server-repairable, so nothing downstream would
  stop it. An agent has no picker. Note the ordering:
  `s.image({ accept: "image/webp", encode: { type: "webp" } })` still takes a PNG,
  because the conversion happens first and it is the result that is checked.

  It is the one tool you construct yourself, because it needs an image library
  and `sharp` ships a compiled binary per platform. Val does not put one in every
  project that installs it, so you decide:

  ```sh
  npm install sharp
  ```

  ```ts
  import sharp from "sharp";
  import { createValImageTools } from "@valbuild/mcp";
  import { sharpImageProcessor } from "@valbuild/mcp/sharp";

  const { valMcpAuthorize, valMcpTools } = initValMcp(valModules, config, {
    extraTools: createValImageTools(sharpImageProcessor(sharp)),
  });
  ```

  Leave `extraTools` out and everything else works as before — the agent can read,
  validate and edit content, it just cannot add an image. `sharp` is passed in
  rather than imported, so you can supply another encoder: `ValImageProcessor` is
  two functions, `read` and `encode`.

  Remotely stored images work too — `s.image().remote()` and
  `s.images({ remote: true })` — and they need nothing extra from the MCP client.
  Adding one does not upload anything to Val's content host: the bytes go into the
  patch store like any other unpublished change, and the push to
  `remote.val.build` happens when you publish, exactly as it does for an image
  added through the Studio. All the tool has to do first is ask the project which
  bucket to name in the ref, and the credential for that is the one your app
  already has — its API key when it has one, and in local development the
  `val login` token in your project, the same one `val validate --fix` uses. If
  you have not logged in, it says so and writes nothing.

  ## `npm create @valbuild` asks

  The starter template now ships the MCP endpoint, and `npm create @valbuild`
  asks whether you want it — and, if you do, whether agents should be able to
  upload images, saying that this adds `sharp`. Both default to yes, and both can
  be answered up front for a scripted setup:

  ```sh
  pnpm create @valbuild my-app --mcp --no-image-uploads
  ```

### Patch Changes

- [#620](https://github.com/valbuild/val/pull/620) [`53f670c`](https://github.com/valbuild/val/commit/53f670c0cf2d7a03a6d068c78b7874ce77652c2a) Thanks [@freekh](https://github.com/freekh)! - MCP: `search_content` — full-text search across the project's content, unpublished changes included.

  The same index the Studio's search box uses, moved into `@valbuild/shared` so both run it, and built fresh on every call. That was the part that looked expensive and is not: indexing `valbuild/web`, a real production site of 20 modules and 206 KB of source, takes 162 ms, and it scales linearly from there — the 10 s default deadline is not reached until roughly 13 MB of content. Loading the modules costs more than indexing them, and every tool call already pays that.

  That ratio between building the index and querying it — 162 ms against 0.2 ms — is why `queries` is a list. Everything expensive happens before the first query runs, so up to 20 of them are answered from a single pass, separately, so a caller can tell which of its guesses found the thing. A bare string still works as one query.

  It returns source paths, so `get_source` reads what it finds. The rest of the arguments narrow or bound the work:

  - `include` / `exclude` — module file path globs, e.g. `["/content/blogs/**"]`. `exclude` is applied after `include`.
  - `limit` — per query, defaulting to 100. A model filters a long list more cheaply than it asks again.
  - `timeoutMs` — stop indexing and answer with what has been indexed so far. The result then carries `timedOut`, the paths of the modules that were not reached, and a hint pointing at `include`.

  Every answer says what it actually searched (`searched: { modules, of }`), so each query's `total` can be read as a count over those modules rather than over the project. Modules you excluded are not reported as omissions — an omission always means the deadline, never your filter.

  `performSearch` now counts all the matches rather than the page it returns, which the Studio's result count gets too: FlexSearch stops as soon as it has the ids it was asked for, so a total taken from a page-sized search was only ever the page size again.

## 0.122.0

### Minor Changes

- [#563](https://github.com/valbuild/val/pull/563) [`be32261`](https://github.com/valbuild/val/commit/be32261af19db8018bc37b180d903416018c0b79) Thanks [@freekh](https://github.com/freekh)! - See how a module looked at any past commit, and restore from it by pointing at it

  Val could publish edits but never look back. Now every commit is a durable
  record you can open, and any part of it can be put back.

  **Open a commit and the Studio splits in two.** The left half is the Studio
  itself — same navigation, same fields, same everything, because it _is_ the
  editor rather than a copy of it. The right half shows the project as that commit
  left it. On a phone the two become one pane and a toggle.

  **Restoring is directed: you point at the old value, then at where it goes.**
  Val does not try to work out which of today's fields corresponds to which of the
  commit's. It cannot be sure — array items splice, schemas move — and a restore
  that guesses wrong writes into the wrong place and looks like it worked. Two
  picks leave nothing to guess. You can restore across paths, so last month's
  headline can become today's tagline.

  Before you click, every field on the "now" side says whether it can hold the
  value you picked, and a field that cannot explains why when you click it rather
  than doing nothing. A changed union is not itself a blocker: what matters is
  whether the value's own shape is still allowed, so a union that gained a case
  restores fine and one that lost the case you are restoring does not.

  Rich text can be restored but is marked "probably fits" rather than confirmed —
  comparing every mark and block against the options a schema allows is not done
  yet, and saying so is better than a confident answer we cannot back. It is
  checked properly the moment you commit to it: before anything is staged, the old
  value is checked against the field it is going into, and a value that cannot be
  that field is refused with the reason. A value that is the right shape but
  breaks a rule about its content — a name too short for its `minLength` — is
  staged and then held at publish, the same as if you had typed it, because a
  restore should not be stricter than typing.

  **A whole module can be put back on its own**, from a commit that changed
  several, without reverting the rest of the commit.

  **Restores are staged, not applied.** They land in pending changes, are reviewed
  beside every other edit, and go out with the next publish. There is also "put
  everything back", for when a whole publish was the mistake.

  To make this possible, publishing now records each changed module's data and the
  schema it was written against. Not the `.val.ts` — git already keeps that, but
  it is code, and turning code back into data means parsing it, which is
  best-effort and stops working as TypeScript, your runtime and Val move on. The
  schema is kept because a value on its own cannot be drawn: showing a module as it
  was at a commit whose schema has since changed needs _that commit's_ schema, and
  nothing in your current checkout has it.

  Things it will not pretend about: a module the commit did not touch says so
  rather than showing today's value; a module saved by a different version of Val
  says the version differs and that nothing is lost; a commit made before Val
  started recording history disables restore with the reason next to it. Images
  and files are restored by re-uploading them, since the bytes at an old commit
  may no longer be on your branch.

  History requires the Val content service. In filesystem mode it reports
  `not-supported-in-fs-mode` rather than faking it from git, which has the files
  but not which of a commit's changes were one editor's work.

### Patch Changes

- [#597](https://github.com/valbuild/val/pull/597) [`1c8b7fd`](https://github.com/valbuild/val/commit/1c8b7fda1e84cd8bd32a03a85d2789598b98c3fb) Thanks [@freekh](https://github.com/freekh)! - Studio: a calmer light mode.

  Light mode was built on full white. Panels, the rail, the bars and every field
  surface were `#ffffff`, and the canvas behind them sat 4% below that — so the
  Studio filled the viewport with one bright sheet, and the floating layout had
  almost no light to distinguish its layers with.

  Every neutral surface now sits one step down the ramp: floating chrome and
  fields at `#fcfcfc`, the canvas at `#f4f4f5`, raised and hover fills at a new
  `#eeeef0`. Nothing large is pure white any more. The luminance gap between a
  panel and the canvas roughly doubles, so panels read as floating rather than as
  part of the page while the chrome gives off noticeably less light.

  The panel hairline and muted text came down a nudge with the surfaces, because
  on a softer background the old values read washed out rather than quiet. Every
  foreground/background pair the chrome renders still meets WCAG AA, and with
  more headroom than before — `contrast.test.ts` holds that.

  Dark mode is unchanged.

## 0.121.0

### Minor Changes

- [#464](https://github.com/valbuild/val/pull/464) [`2bcc6fd`](https://github.com/valbuild/val/commit/2bcc6fdff8d668123e07e3c5e81ac6fa1436e47b) Thanks [@freekh](https://github.com/freekh)! - Add staging and unstaging of pending changes, so one person can publish a small fix without shipping somebody else's unfinished work.

  A **patch group** is the set of patches one user has chosen to publish. It is not a patch _set_: a patch set is computed from the schema and says which patches must move together, while a patch group is curated and says which ones you want live.

  A group holds its owner's own work plus whatever the closure entangled with it — not everything pending. **So Publish changes meaning on a shared branch: it ships your changes and what they depend on, instead of everything anybody has pending.** That is the feature. Unstaging goes further: hold one of your own changes back and it leaves both your preview and your publish, while still existing for everyone else.

  The rule relating the two is that for every group and every patch set, the group's members within that patch set must form a prefix in patch-chain order. Staging a change therefore pulls in whatever preceded it in the same patch set; unstaging drops whatever was built on top of it. The compare view names what a toggle moves, and whose it is, rather than quietly enlarging or shrinking a publish.

  Editing inside a region you are holding back is allowed, and the patches you were holding are loaded back in rather than the edit being refused. An earlier design made such a region read-only until it was staged again, because an author picks an array index while looking at their own view — so re-staging patches afterwards can shift the content under the path they just chose, and their edit lands on the wrong element cleanly, with every invariant intact and only the content wrong. That guard is not what ships. It is a rare shape in practice, since two people's edits mostly land in different routes, and refusing an edit for a reason the author cannot see is a worse everyday experience than the case it prevents. Instead the real result is shown immediately: the widened set is what the editor renders and what the compare view lists.

  Also fixes a pre-existing bug in patch set grouping: patch set paths were compared with a raw string prefix test, and nothing terminates a path segment, so `?foobar/title` matched `?foo`. Deleting record key `foo` and retitling record key `foobar` were treated as one inseparable change. Previously that over-grouped two unrelated edits in the review screen; with staging it would have meant publishing a deletion nobody asked for.

  The `/patches` routes gain optional patch group fields and `/patch-groups/~/patches` is new. This needs a content API that has patch groups. Filesystem mode keeps the group in the client, since it has a single author and already sends an explicit patch id list when publishing.

  When a save pulls other people's changes in, you are told: a toast names how many and whose. There is no undo, because your edit was written against the view those changes produce and now depends on them — the compare view shows the widened set.

  Two other things keep a session honest about a shared branch. `/stat` now says which pending changes have already been published, so another author's publish stops looking pending in your Studio the moment it lands rather than when the site redeploys. And Publish refuses, without writing anything, if somebody published while you were reviewing — the review screen you acted on described a branch that has since moved.

  Two things this does **not** do yet, both of which need the group annotation to refresh on its own rather than only inside a fetch for missing patch ids:

  - a stage or unstage in one tab does not reach another tab;
  - if persisting a stage fails, the local view keeps it until the page is reloaded.

  `docs/independent-publish/DESIGN.md` describes the model and lists what is still a judgement call.

- [#605](https://github.com/valbuild/val/pull/605) [`6794d29`](https://github.com/valbuild/val/commit/6794d2980bc81284ab7f2cc667f01cc21c9e3a79) Thanks [@freekh](https://github.com/freekh)! - `s.settings()`: the project's settings, as content.

  A settings module is one per project, at the root of the content tree:

  ```typescript
  // settings.val.ts
  export default c.define("/settings.val.ts", s.settings(), {});
  ```

  Register it in `val.modules.ts` like any other module, and it shows up in the
  Studio under the cog at the foot of the left rail. Everything in it is content:
  it is edited as a draft, it appears in the publish diff, and it is the same for
  everyone working on the project.

  Every key is optional, at every level, so `{}` is a complete settings module —
  and stays one as sections are added. What it holds today is the assistant:

  ```typescript
  export default c.define("/settings.val.ts", s.settings(), {
    assistant: {
      enabled: true,
      context: "A CMS for developers, run by a team of four in Oslo.",
      tone: "Plain and direct. British English, sentence case in headings.",
    },
  });
  ```

  `context` is background the assistant would otherwise guess at; `tone` is how it
  should write when it writes content. Both are sent with every message it makes.

  `enabled` decides whether editors have an assistant, and it has **three** states
  rather than two:

  - `true` — they do.
  - `false` — they do not, and every trace of it goes: no button in the top bar,
    no row in the quick actions, no panel, nothing sent.
  - unset — nobody has decided. The assistant is still **shown**, and asks to be
    turned on before it is used. Hiding an assistant nobody has decided about
    means nobody discovers it; quietly enabling one means a project starts sending
    its content to a model because it did not know to say no.

  A project with no settings module at all has an assistant, as before: there is
  nowhere to record a decision, and nowhere for the prompt to write the answer.

  **Breaking: `ai.chat` is gone from `val.config.ts`.** Whether the assistant is
  available is a decision about the project's content, made by the people who edit
  it, so it moved to settings — turning the chat on used to take a developer, a
  deploy and a code review of a boolean. Remove the whole block:

  ```diff
   const { s, c, val, config } = initVal({
  -  ai: {
  -    chat: {
  -      experimental: { enable: true },
  -      suggestions: ["Summarize", "Fix typos at this page"],
  -      title: "Ask me anything",
  -      description: "Val can answer questions about the content.",
  -    },
  -  },
   });
  ```

  `experimental.enable` becomes `assistant.enabled` in the settings module.
  `suggestions`, `title` and `description` are removed with nothing replacing
  them: the assistant now opens with its own copy. A project that had the chat
  enabled and wants it to stay on for everyone should write
  `assistant: { enabled: true }` — otherwise editors are offered it and asked.

  `ai.commitMessages` stays in `val.config.ts`, and is unaffected.

  Two settings modules, or one in a subdirectory, is a module error: the dev
  server refuses to serve sources, `npx val validate` reports it against the file,
  and the Studio says so rather than picking one.

### Patch Changes

- [#609](https://github.com/valbuild/val/pull/609) [`105479b`](https://github.com/valbuild/val/commit/105479b84a08846f1fe5971916f6a54275198d12) Thanks [@freekh](https://github.com/freekh)! - Studio: the focus ring on a dropdown's search field now runs the full width of the box.

  A ring is a `box-shadow`, so it is drawn around whatever element carries it — and the search input is not the search field you see. It starts after the magnifier icon and stops short of the row's padding, so the ring was a rectangle floating inside the popover with a gap down each side. It is on the row now, edge to edge, with its top corners following the box's own radius.

- [#595](https://github.com/valbuild/val/pull/595) [`55ec736`](https://github.com/valbuild/val/commit/55ec73651394908b6f440e360d181b95a91c0a93) Thanks [@freekh](https://github.com/freekh)! - Show your own name on the changes you have just made.

  In a hosted project, a change made in the Studio showed up under "Unknown
  author" as soon as it was made, next to earlier changes that were correctly
  attributed. Reloading the page fixed it, which is what made it look arbitrary:
  whether a change had an author depended on whether it had been fetched from the
  server or made in the tab you were looking at.

  A patch created in the browser carried no author at all. The server stamps one
  from your session when the patch is saved, but the Studio never re-fetches a
  patch it made itself, so nothing in the tab ever learned who wrote it — the
  change history, the author avatars on a field and the review screen all grouped
  it under an author they could not name.

  Such a patch is now stamped with the current profile as it is created, which is
  the same author the server records for it.

- [#604](https://github.com/valbuild/val/pull/604) [`2db27d5`](https://github.com/valbuild/val/commit/2db27d555441bee2dd31817acc8c92b7b718ee55) Thanks [@freekh](https://github.com/freekh)! - Studio: duplicate a page, publish feedback on a phone, and a batch of visual fixes.

  **Duplicate a page.** A page can be copied to a new URL from two places: the
  Copy button beside its title, and a Copy button on its row in the Pages panel.
  Both open the same route form the New page and Change URL controls use,
  prefilled with the page's own URL, so the usual answer is one segment away — and
  both go through one `copy` patch op, so the copy is the page rather than
  somebody's second idea of what a page contains. Media comes along by reference:
  duplicating a page with a gallery on it does not re-upload the gallery.

  **Publishing from a phone says something.** The mobile bottom bar takes the row
  the status bar would have had, so the deploy feed lived only inside the settings
  sheet: the Publish button went back to "Publish" and that was the whole of the
  feedback, with no way to tell a push that had landed from one that never went
  out. The list now appears above the bottom bar when a publish goes out, and
  closes itself once everything is live.

  **Review is always in the quick actions.** It appeared only when something was
  pending, which left "is anything of mine still unpublished?" unanswerable on a
  phone — an empty row of quick actions looks the same as one that has not loaded.

  **The compare view fits on a phone.** One long line used to scroll the whole
  review sideways, and a long value pushed everything after it off the bottom.
  Each compare box now scrolls its own content, and a read-only value in a dense
  row is text rather than a disabled input — so a line longer than the box wraps
  instead of being clipped at the right edge with no way to reach the rest.

  **Author pictures show up everywhere they should.** The Studio had five ways to
  draw a person, and the one in the top bar, the rail and the account panel drew
  initials only — so the same author looked like two different people depending on
  which surface you were on. There is one now, and it shows the profile picture
  wherever there is one, falling back to initials.

  Also:

  - The AI chat keeps the caret in the composer when an answer completes. The
    composer is made non-editable while the assistant is answering, which drops
    the focus, and nothing put it back — so every follow-up question started with
    a click.
  - A long tool name in the AI chat's tools row no longer pushes the row off to
    the right. Radix's scroll areas size their content as a table, which makes
    `truncate` grow the row to the full untruncated width instead of clipping it.
  - A focused combobox no longer draws its highlight outside itself. The focus
    ring is painted outside the border box, so on a full-width trigger — and on
    the search input inside the dropdown — it landed on the enclosing field and
    was clipped or drawn over the box's own border.
  - The deployments list no longer pops open for a publish that has been serving
    the site for more than ten minutes. It opens for a commit it has not seen
    before, which could not tell a publish that just happened from one that
    finished before the tab existed.

## 0.120.4

### Patch Changes

- [#599](https://github.com/valbuild/val/pull/599) [`6df3cae`](https://github.com/valbuild/val/commit/6df3caec1cc043a07b532d3174583b8218d4871d) Thanks [@freekh](https://github.com/freekh)! - Add a referenced entry from a `s.keyOf()` field

  A `keyOf` field can now create the entry it is about to point at. Where the
  author you want is not in the authors record yet, name them here: the entry is
  added to the referenced record, the field points at it, and you are taken to the
  new entry to fill it in — instead of leaving the page you were editing to create
  it and coming back to link it.

  - Two ways in, as reference fields normally have: **New entry** at the foot of
    the dropdown, and a **+** beside it for when you have not opened the dropdown.
  - The key you searched for is what the new entry is named, and the option stays
    offered when the search matches nothing — which is how you got there.
  - The key box says what a key is here, from the record's `key` description (or
    the field's own).
  - A key that already exists is refused rather than overwriting that entry.
  - Where the field renders the entry inline, it stays put: the new entry's fields
    are already on screen.
  - Only for a record — an object's keys are its schema. A router record asks for
    the new key per route segment, the same form the sitemap's "Add page" uses.

## 0.120.3

### Patch Changes

- [#596](https://github.com/valbuild/val/pull/596) [`9b96184`](https://github.com/valbuild/val/commit/9b96184cf6ad6d52a714867fb1527eeec6c776f4) Thanks [@freekh](https://github.com/freekh)! - The AI model picker opens again, and shows even with one model on offer.

  Its menu was portalled to `document.body` — outside the shadow root the Studio
  renders in, where none of Val's styles reach it and nothing lifts it above the
  overlay. The menu did open; it was invisible behind the Studio, which reads as a
  trigger that does nothing. It now portals into the Studio's own container, like
  every other popup there.

  The picker also used to hide itself unless there were at least two models, so an
  account with one reachable model had nothing telling it which model was
  answering. It now renders whenever there is a model at all, and only disappears
  when there are none — which means AI is off, not that there is no choice.

  `DropdownMenuContent` now renders inline instead of portalling when it is given
  no container — the posture `TooltipContent` already took — so this cannot
  silently happen again: a clipped menu can be recovered from, an invisible one
  cannot.

- [#600](https://github.com/valbuild/val/pull/600) [`1a2484a`](https://github.com/valbuild/val/commit/1a2484a309679bd5e963d626466c2828f74d49f8) Thanks [@freekh](https://github.com/freekh)! - Fix dragging a list row on a phone, which picked the row up well below the
  finger and dropped it about three rows too far down.

  The card that follows your finger is positioned against the viewport, and on a
  phone the editor and the page ride on a track that was transformed even while it
  was standing still. A transformed box becomes the reference point for everything
  positioned that way inside it, so with the preview open the card was placed
  against a box already pushed down by the strip of switches — 132px of it. The
  same offset decided where the row landed, which is why the drop missed by
  roughly three positions.

  The track is now only transformed while it is actually moving between the
  editor and the page.

  Drag handles also declare `touch-action: none`, as dnd-kit asks them to. Without
  it a phone can decide mid-drag that your finger meant to scroll, and from that
  moment the drag and the list move at the same time. The rule had been written as
  an HTML attribute rather than as CSS, so it had never taken effect.

- [#601](https://github.com/valbuild/val/pull/601) [`71becc7`](https://github.com/valbuild/val/commit/71becc7e543432e4a57e36d54aaf803e9a447ffd) Thanks [@freekh](https://github.com/freekh)! - Fix the page going unclickable behind a stale selection box in the overlay's select mode.

  In select mode the overlay draws a box over whatever Val content the pointer is on, and that box is what turns a click into "edit this" — it sits above the page and stops the event. The box was only ever written when the pointer found tagged content, never cleared when it left, so it stayed parked over the last thing the pointer crossed. Everything under that rectangle stopped responding for as long as select mode was on: most visibly, a link there could not be followed.

## 0.120.0

### Minor Changes

- [#589](https://github.com/valbuild/val/pull/589) [`c2d3c0e`](https://github.com/valbuild/val/commit/c2d3c0e6c2010c0a94c725d9dbaa618998773e8a) Thanks [@freekh](https://github.com/freekh)! - **Breaking:** `s.richtext()` options are flat.

  The `style`, `block` and `inline` groups are gone — every option is a key of its
  own. The names are unchanged, so updating a schema is only a matter of removing
  the wrappers:

  ```ts
  // before
  s.richtext({
    style: { bold: true, italic: true },
    block: { h1: true, ul: true },
    inline: { a: true, img: s.image() },
  });

  // after
  s.richtext({
    bold: true,
    italic: true,
    h1: true,
    ul: true,
    a: true,
    img: s.image(),
  });
  ```

  The groups never carried any meaning the option names did not already have, and
  they cost something real: an option name and its `ValRichText` theme key were
  spelled differently (`block.h1` vs `theme.h1`), so the type that keeps a theme
  exhaustive had to restate all thirteen options by hand. It is now a mapped type
  over the options themselves — which also fixes an inconsistency in it: enabling
  links with a schema (`a: s.route()`) rather than `a: true` now requires an `a`
  key in the theme, the way `img` always has.

  `ValRichText` themes were already flat and are unchanged. The serialized schema
  that the server sends the Studio is flat too, so a project must not mix
  `@valbuild/*` versions across this release.

## 0.119.0

### Minor Changes

- [#587](https://github.com/valbuild/val/pull/587) [`84165f7`](https://github.com/valbuild/val/commit/84165f743eb5802da1e8079bbe98eafcb2cdcec8) Thanks [@freekh](https://github.com/freekh)! - The AI assistant's tool calls are now a row of their own above the answer,
  collapsed to a summary you can expand.

  They used to be listed inside the assistant's own bubble, one line per call, so
  a turn that read a schema, searched, read a source and wrote a patch pushed its
  answer off the bottom of the panel — the part you were waiting for was the part
  you had to scroll for. The row now says what is happening ("Reading content…"
  while it runs, "Used 5 tools" when it is done) and the list is behind a
  disclosure.

  While a call is in flight its label shimmers, so the row shows the turn is
  still working without a spinner to stare at. It marks a call as pending, not as
  healthy: a stalled call stays pending, and goes on shimmering until the turn
  times out.

  `ask_user_question` cards stay outside the collapsible and always visible: the
  turn is blocked until one is answered, and hiding it leaves a session that has
  visibly stopped with nothing on screen saying why.

## 0.118.0

### Minor Changes

- [#574](https://github.com/valbuild/val/pull/574) [`198ba8b`](https://github.com/valbuild/val/commit/198ba8bd8e6c921660e97f5cd26fb17f2d5f3f95) Thanks [@freekh](https://github.com/freekh)! - The assistant lets you pick which model answers, from the models your key can
  actually reach.

  The content server now asks each provider what a key may use and reports the
  answer; the Studio offers exactly that, beside the composer. Which model to use
  is a per-message decision — something cheap for a typo, something strong for a
  hard question — so the control sits where the message is written rather than in
  a settings panel.

  The choice is remembered per browser and re-checked against what is on offer
  each time the assistant starts, so a model an account has lost access to is
  quietly replaced instead of being sent and refused.

  A content server that does not report models, or could not reach a provider,
  leaves the built-in catalog as the fallback, filtered to reachable providers.

### Patch Changes

- [#574](https://github.com/valbuild/val/pull/574) [`198ba8b`](https://github.com/valbuild/val/commit/198ba8bd8e6c921660e97f5cd26fb17f2d5f3f95) Thanks [@freekh](https://github.com/freekh)! - AI errors can now show what the provider actually said.

  The content server sends an optional `details` with a failed turn — provider,
  status, error type, request id and the provider's verbatim message — and the
  assistant puts it behind a "Details" disclosure. Closed by default, because it
  is for whoever is going to act on it; findable without a server log, which is
  the point.

- [#584](https://github.com/valbuild/val/pull/584) [`fe6a398`](https://github.com/valbuild/val/commit/fe6a3981691394e6f34d4d80ec17febd356a98cc) Thanks [@freekh](https://github.com/freekh)! - Fix `useCurrentAuthorId` throwing outside a `ValProvider`, which broke every render of the review screen in isolation.

## 0.117.1

### Patch Changes

- [#583](https://github.com/valbuild/val/pull/583) [`0ae7bac`](https://github.com/valbuild/val/commit/0ae7bac8a186460bc2b31f2ded89b00027bafb55) Thanks [@freekh](https://github.com/freekh)! - The Studio now links out to the project in Val Build.

  Val edits content; everything else about a project — who can edit it, its API
  keys, its versions, its subscription — lives at
  [admin.val.build](https://admin.val.build), and there was no way to get from
  one to the other. You had to know the URL, or find the project again from the
  front page.

  Two ways there now:

  - **The project name in the top bar is a link.** It opens the project's own
    page in Val Build, in a new tab, since leaving the Studio would mean leaving
    whatever is being edited in it.
  - **Settings has a Project section**, with **Administer project** — the same
    page — and **Manage members**, which opens the organisation's member list.

  Both hang off `project` in `val.config`, which is `"<org>/<project>"`. A
  project that has not been connected to Val Build — no `project`, or one that is
  not in that form — has no page to open, so the name stays a plain label and the
  Settings section is not shown at all, rather than offering a link that lands on
  a sign-in for an organisation you may not be in.

## 0.117.0

### Patch Changes

- [#579](https://github.com/valbuild/val/pull/579) [`b2812ae`](https://github.com/valbuild/val/commit/b2812ae4ee03e005ecead3365f49c625e536f94d) Thanks [@freekh](https://github.com/freekh)! - Every release now ships a changelog. Each package's `CHANGELOG.md` records what
  changed under the version that shipped it — with a link to the pull request, the
  commit and the author — and the same entry becomes the body of the GitHub
  Release for the tag. The file is included in the npm tarball, so it is also
  readable from an installed copy.

  Up to now those changelogs were generated empty, and the GitHub Releases with
  them, so there was no record of what any given version contained. Releases from
  this one on have one; earlier versions stay blank.
