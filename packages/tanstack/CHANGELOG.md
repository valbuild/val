# @valbuild/tanstack

## 0.142.0

### Patch Changes

- [#805](https://github.com/valbuild/val/pull/805) [`fa03698`](https://github.com/valbuild/val/commit/fa03698ef0f2c7a6df334b4ba0e41843bde60029) Thanks [@freekh](https://github.com/freekh)! - Groundwork for proposals on the Val platform: a server can be told it is running at a proposal's address (`proposal` in the http options, `proposalFromEnv` to read it from the platform). There, the content the proposal has saved replaces the bundled content for those modules on every read, edits go to the proposal's branch, and Save commits to the proposal instead of the site. Nothing changes for a site that is not given a proposal.
- Updated dependencies [[`1ec4ff4`](https://github.com/valbuild/val/commit/1ec4ff4165a33f2248b52608ff58e626523e4212), [`1671bce`](https://github.com/valbuild/val/commit/1671bce6f0b65dac77e51655f24ef825f4671ebb), [`bb63738`](https://github.com/valbuild/val/commit/bb63738aabed1cf1287611ecaab7c35fc4b08a12), [`fa03698`](https://github.com/valbuild/val/commit/fa03698ef0f2c7a6df334b4ba0e41843bde60029), [`3d2b9e8`](https://github.com/valbuild/val/commit/3d2b9e8c11aa6a4449527e2a1bbb363566797a14), [`a3236a5`](https://github.com/valbuild/val/commit/a3236a5f2c41b92422b40340dba060b53218c6ab), [`f14e0aa`](https://github.com/valbuild/val/commit/f14e0aabedba07b832b1453d49635af5d2fbc019), [`521fe94`](https://github.com/valbuild/val/commit/521fe9400c0b660aa5b3642942cd0cc26622f193)]:
  - @valbuild/server@0.142.0
  - @valbuild/ui@0.142.0
  - @valbuild/shared@0.142.0
  - @valbuild/language-server@0.142.0
  - @valbuild/mcp@0.142.0
  - @valbuild/react@0.142.0

## 0.141.1

### Patch Changes

- Updated dependencies [[`6faacda`](https://github.com/valbuild/val/commit/6faacda398fc92bec187b7afe07a53228a6f2a3b), [`14b18d7`](https://github.com/valbuild/val/commit/14b18d7cb145cec1bc1cd832b9ca857ff4b45adc)]:
  - @valbuild/ui@0.141.1
  - @valbuild/server@0.141.1
  - @valbuild/react@0.141.1
  - @valbuild/language-server@0.141.1
  - @valbuild/mcp@0.141.1

## 0.141.0

### Minor Changes

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

- Updated dependencies [[`199e214`](https://github.com/valbuild/val/commit/199e21471d98806fb34c579cb876560078c928b9), [`9cbe428`](https://github.com/valbuild/val/commit/9cbe42895d006d55c3d993dc27f0779808b85306), [`fb5f097`](https://github.com/valbuild/val/commit/fb5f09721ac07f4d90b8502fdbee3fb3884d9688), [`6473a2e`](https://github.com/valbuild/val/commit/6473a2efe874f1749b27ed6f8ac4e0d19805edb1), [`ba3f330`](https://github.com/valbuild/val/commit/ba3f3300a3dd8649e154097cdfca3b64db209d89)]:
  - @valbuild/core@0.141.0
  - @valbuild/server@0.141.0
  - @valbuild/shared@0.141.0
  - @valbuild/ui@0.141.0
  - @valbuild/language-server@0.141.0
  - @valbuild/react@0.141.0
  - @valbuild/mcp@0.141.0

## 0.140.2

### Patch Changes

- Updated dependencies [[`df1e5f5`](https://github.com/valbuild/val/commit/df1e5f5f94391f25c71839cc476a51198b90db4d)]:
  - @valbuild/ui@0.140.2
  - @valbuild/server@0.140.2
  - @valbuild/shared@0.140.2
  - @valbuild/react@0.140.2
  - @valbuild/language-server@0.140.2
  - @valbuild/mcp@0.140.2

## 0.140.0

### Patch Changes

- [#793](https://github.com/valbuild/val/pull/793) [`092e6a7`](https://github.com/valbuild/val/commit/092e6a7f78bcfcf4c6cecaf34407fdfc580ebbc1) Thanks [@freekh](https://github.com/freekh)! - A draft page on TanStack Start is now rendered as the draft by the server, so it no longer shows the published text first and the draft a moment later — most noticeable when you reload right after publishing.

  Read the request's draft in your site layout's loader and pass it to `ValProvider`:

  ```tsx
  // src/val/server.ts
  export const { fetchValDraft /* , fetchVal, ... */ } = initValContent(
    config,
    valModules,
    { draftMode },
  );

  // src/routes/_site.tsx
  const getValDraft = createServerFn().handler(() => fetchValDraft());

  export const Route = createFileRoute("/_site")({
    loader: () => (typeof document === "undefined" ? getValDraft() : null),
    component: SiteLayout,
  });

  function SiteLayout() {
    const draft = Route.useLoaderData();
    return (
      <ValProvider config={config} suspend draft={draft}>
        {/* ... */}
      </ValProvider>
    );
  }
  ```

  Visitors pay one cookie lookup and nothing else. Without `draft`, pages behave as before. Edited `.jsonValues()` entries are rendered as the draft too; the others render from the build, as they do for visitors.

  Also: a draft's `.jsonValues()` entries now include changes that were published after the build being served, instead of showing the old value until the next build is live.

  Also: a renamed or duplicated `.jsonValues()` entry now has its content in the draft, on the page and when the Studio reads the entry, instead of failing to load until it is published.

- Updated dependencies [[`cb93874`](https://github.com/valbuild/val/commit/cb938748aec15fd0ac3814c1696a2dd78ad63c27), [`092e6a7`](https://github.com/valbuild/val/commit/092e6a7f78bcfcf4c6cecaf34407fdfc580ebbc1)]:
  - @valbuild/ui@0.140.0
  - @valbuild/server@0.140.0
  - @valbuild/shared@0.140.0
  - @valbuild/react@0.140.0
  - @valbuild/language-server@0.140.0
  - @valbuild/mcp@0.140.0

## 0.139.2

### Patch Changes

- Updated dependencies [[`4d9e12c`](https://github.com/valbuild/val/commit/4d9e12c5286f981c7a8a7820db1bf580e327d2ea), [`1c3eb3a`](https://github.com/valbuild/val/commit/1c3eb3af91f6dfeff94a95d80d5291a1acf1baf2)]:
  - @valbuild/ui@0.139.2
  - @valbuild/react@0.139.2
  - @valbuild/server@0.139.2
  - @valbuild/language-server@0.139.2
  - @valbuild/mcp@0.139.2

## 0.139.1

### Patch Changes

- Updated dependencies [[`238057d`](https://github.com/valbuild/val/commit/238057d2f17a6bdd22d0bd4316dd8e3a8843a85d), [`8f08418`](https://github.com/valbuild/val/commit/8f0841882d13c991d31dfbb03dd4873c9ab636b4), [`238057d`](https://github.com/valbuild/val/commit/238057d2f17a6bdd22d0bd4316dd8e3a8843a85d), [`db13bed`](https://github.com/valbuild/val/commit/db13bed902f9f9147feb5be07ce47fe8b5b143f9), [`5ea70ce`](https://github.com/valbuild/val/commit/5ea70cefde3c74961cfa76b4a5f4c333b850b60a)]:
  - @valbuild/ui@0.139.1
  - @valbuild/core@0.139.1
  - @valbuild/server@0.139.1
  - @valbuild/shared@0.139.1
  - @valbuild/react@0.139.1
  - @valbuild/language-server@0.139.1
  - @valbuild/mcp@0.139.1

## 0.139.0

### Patch Changes

- Updated dependencies [[`3eb5031`](https://github.com/valbuild/val/commit/3eb503167ae466ee586303c95efcc14665129481)]:
  - @valbuild/core@0.139.0
  - @valbuild/shared@0.139.0
  - @valbuild/ui@0.139.0
  - @valbuild/language-server@0.139.0
  - @valbuild/mcp@0.139.0
  - @valbuild/react@0.139.0
  - @valbuild/server@0.139.0

## 0.138.6

### Patch Changes

- [#774](https://github.com/valbuild/val/pull/774) [`9d28775`](https://github.com/valbuild/val/commit/9d287750631b239b70bc7545e3b9fa9011e81db7) Thanks [@freekh](https://github.com/freekh)! - Edits no longer disappear from a site on Val Build for up to a minute after its first publish.

  For a short while after a publish, the site can still serve the previous build. If that build was the project's starting template, it was treated as though it already had the new changes, so they vanished from the page until the new build reached you. Each build now tells Val's content service which build it is, and gets exactly the changes it is missing.

- Updated dependencies [[`9d28775`](https://github.com/valbuild/val/commit/9d287750631b239b70bc7545e3b9fa9011e81db7), [`9d28775`](https://github.com/valbuild/val/commit/9d287750631b239b70bc7545e3b9fa9011e81db7)]:
  - @valbuild/ui@0.138.6
  - @valbuild/server@0.138.6
  - @valbuild/react@0.138.6
  - @valbuild/language-server@0.138.6
  - @valbuild/mcp@0.138.6

## 0.138.5

### Patch Changes

- Updated dependencies [[`c532afc`](https://github.com/valbuild/val/commit/c532afc1818ee0249ad227a7da029c3e8d06baa8)]:
  - @valbuild/ui@0.138.5
  - @valbuild/react@0.138.5
  - @valbuild/server@0.138.5
  - @valbuild/language-server@0.138.5
  - @valbuild/mcp@0.138.5

## 0.138.4

### Patch Changes

- [#771](https://github.com/valbuild/val/pull/771) [`63bff05`](https://github.com/valbuild/val/commit/63bff0589b6df42efaa63ec606688d20a9670439) Thanks [@freekh](https://github.com/freekh)! - Changes that are already published no longer briefly vanish from the Studio, or show up twice, right after a publish in app mode.

  A build the Studio makes in the browser now records which publish it was made for, so Val knows exactly which changes the running site already has. Before this, Val worked that out from whichever build was live, and was wrong for a moment while a publish was going live. A reload in that moment could hide changes that were not on the site yet, or apply ones that were a second time. Projects set up before this release need no changes.

- Updated dependencies [[`63bff05`](https://github.com/valbuild/val/commit/63bff0589b6df42efaa63ec606688d20a9670439), [`0a885b1`](https://github.com/valbuild/val/commit/0a885b1f0304517b167b959958464066194732d0), [`8b1e47e`](https://github.com/valbuild/val/commit/8b1e47e50f9556d8469358af93ba32a084e2e131), [`58d13a2`](https://github.com/valbuild/val/commit/58d13a2a534421b341b1bf71d02f0a2290fc0d61), [`4268beb`](https://github.com/valbuild/val/commit/4268beb4beec53cb52584f59f9bbd5ffdcc9095d), [`e79451f`](https://github.com/valbuild/val/commit/e79451faab37f46e2039d681a19eea06d537dc44)]:
  - @valbuild/ui@0.138.4
  - @valbuild/server@0.138.4
  - @valbuild/shared@0.138.4
  - @valbuild/react@0.138.4
  - @valbuild/language-server@0.138.4
  - @valbuild/mcp@0.138.4

## 0.138.3

### Patch Changes

- Updated dependencies [[`a6cefc8`](https://github.com/valbuild/val/commit/a6cefc870436c9f981d6b831c318416eb6f506e6), [`9d062c2`](https://github.com/valbuild/val/commit/9d062c23597d47d80b66a94091442c5409e7e415)]:
  - @valbuild/ui@0.138.3
  - @valbuild/react@0.138.3
  - @valbuild/server@0.138.3
  - @valbuild/language-server@0.138.3
  - @valbuild/mcp@0.138.3

## 0.138.2

### Patch Changes

- [#762](https://github.com/valbuild/val/pull/762) [`3dd8e35`](https://github.com/valbuild/val/commit/3dd8e3539213505fdb03378d4a0145ae12749943) Thanks [@freekh](https://github.com/freekh)! - The TanStack Start toolchain `@valbuild/tanstack` is developed and tested against is now `@tanstack/react-start@1.168.60` (with `@tanstack/react-router@1.170.41`), the first release with the fix for the XSS vulnerability [GHSA-qx66-fv34-fjm8](https://github.com/advisories/GHSA-qx66-fv34-fjm8) (CVE-2026-102989), which affects `@tanstack/react-start` `>=1.143.12 <1.168.60`.

  `@valbuild/tanstack` does not bring TanStack Start with it — your app's own `@tanstack/react-start` is the one that ships — so **upgrade it to `>=1.168.60`** (`pnpm add @tanstack/react-start@^1.168.60 @tanstack/react-router@^1.170.41`) and check that your lock file no longer resolves an older one, including `@tanstack/start-server-core` below `1.169.39`. Vercel blocks deploys whose dependency tree contains a vulnerable version.

- Updated dependencies [[`2beb226`](https://github.com/valbuild/val/commit/2beb226446c76eb71026f43e04c13943da4a1e31), [`cf3bbc8`](https://github.com/valbuild/val/commit/cf3bbc8fc89ff349aac5ab101d0b4f28164583e6), [`443cdcd`](https://github.com/valbuild/val/commit/443cdcdfa8948db22a54adef2ad5e18d9f9868e9)]:
  - @valbuild/ui@0.138.2
  - @valbuild/shared@0.138.2
  - @valbuild/core@0.138.2
  - @valbuild/react@0.138.2
  - @valbuild/server@0.138.2
  - @valbuild/language-server@0.138.2
  - @valbuild/mcp@0.138.2

## 0.138.1

### Patch Changes

- Updated dependencies [[`1d1bb1e`](https://github.com/valbuild/val/commit/1d1bb1e5937a4194f79e1df040cb800e6bbcb865)]:
  - @valbuild/ui@0.138.1
  - @valbuild/react@0.138.1
  - @valbuild/server@0.138.1
  - @valbuild/language-server@0.138.1
  - @valbuild/mcp@0.138.1

## 0.138.0

### Patch Changes

- Updated dependencies [[`57af895`](https://github.com/valbuild/val/commit/57af8959cc46519a405b1ed7441623f8bf2e6d27), [`c523506`](https://github.com/valbuild/val/commit/c523506c8b5e148864f401c005b913330e436499), [`6216172`](https://github.com/valbuild/val/commit/62161729aa40f737590b0a8093c0394385fffd8d), [`40e933d`](https://github.com/valbuild/val/commit/40e933da7fe01cfe1c3f4a43c156f0b2f8a11f62), [`5876fe0`](https://github.com/valbuild/val/commit/5876fe075fdee1f76f1cdaa2488ac52c58c894a8), [`c523506`](https://github.com/valbuild/val/commit/c523506c8b5e148864f401c005b913330e436499)]:
  - @valbuild/core@0.138.0
  - @valbuild/ui@0.138.0
  - @valbuild/server@0.138.0
  - @valbuild/shared@0.138.0
  - @valbuild/language-server@0.138.0
  - @valbuild/mcp@0.138.0
  - @valbuild/react@0.138.0

## 0.137.0

### Patch Changes

- [#676](https://github.com/valbuild/val/pull/676) [`43b58f2`](https://github.com/valbuild/val/commit/43b58f2962840883badf91950da2c51b89d1c7cb) Thanks [@freekh](https://github.com/freekh)! - External page keys are now validated, and `mailto:` and `tel:` are allowed.

  `externalPageRouter` documented a rule — a key must start with `https://` or
  `http://` — and never enforced it: the validator collected the errors and then
  returned an empty list, so a key like `discord.gg/val` or `/about` was accepted
  in silence and behaved as a relative link on the site.

  Fixing that made the rule itself worth looking at, because it was a rule about
  the protocol standing in for a rule about links. A contact page's email address
  and phone number are external pages to whoever maintains the list, and they
  were refused. So the rule that is now enforced is a deny list rather than an
  allow list: a key must have a scheme, and the scheme must not be one of
  `javascript:`, `data:`, `vbscript:`, `file:` or `blob:` — which are not links
  at all. An external page key ends up in an `href` in your site's own markup, so
  those stay refused however the router is configured.

  A project that wants to be stricter says so:

  ```ts
  s.record(item).router(externalPageRouter({ schemes: ["https", "mailto"] }));
  ```

  `initVal()` from `@valbuild/next` and `@valbuild/tanstack` hands you the
  callable form, so the narrowed version typechecks in an app.

  Val Studio applies the same rule while you type — it calls the same function —
  and shows a narrowed project's own list in the message.

  If your project has a key with no scheme at all, it will start showing a
  validation error on that entry. Give it one, or move it out of the external
  router.

- Updated dependencies [[`8f60073`](https://github.com/valbuild/val/commit/8f60073e5490971a615cebbe8ea1243c67e43530), [`af7a4ba`](https://github.com/valbuild/val/commit/af7a4baa63da5d8a226166377a354cf2fc0c1d77), [`48ac9f0`](https://github.com/valbuild/val/commit/48ac9f06dd59a5b4ca60232b1ef198cf42f23aa6), [`daecf41`](https://github.com/valbuild/val/commit/daecf416f51990569a47a6a9ee9174b1a57f98c2), [`43b58f2`](https://github.com/valbuild/val/commit/43b58f2962840883badf91950da2c51b89d1c7cb), [`9b09bf3`](https://github.com/valbuild/val/commit/9b09bf38c9d5912f41fec1c18aa87455fd32f616), [`e2bfc0e`](https://github.com/valbuild/val/commit/e2bfc0e40383fe25d3ec0473d1032f6264a8939f), [`9b09bf3`](https://github.com/valbuild/val/commit/9b09bf38c9d5912f41fec1c18aa87455fd32f616), [`8e49bf4`](https://github.com/valbuild/val/commit/8e49bf41ad6a8ad3b01e502fb7ce0369baa316db), [`370d0df`](https://github.com/valbuild/val/commit/370d0df7ea45aeeafb4520318018d7c4e1c040d6), [`14877a8`](https://github.com/valbuild/val/commit/14877a85c5add4daa16836470b8739180a9fe8c6), [`beda04b`](https://github.com/valbuild/val/commit/beda04bd326cbab18ed103e8d43917b16f43bd8c)]:
  - @valbuild/ui@0.137.0
  - @valbuild/server@0.137.0
  - @valbuild/shared@0.137.0
  - @valbuild/core@0.137.0
  - @valbuild/react@0.137.0
  - @valbuild/language-server@0.137.0
  - @valbuild/mcp@0.137.0

## 0.136.10

### Patch Changes

- Updated dependencies [[`fef29b0`](https://github.com/valbuild/val/commit/fef29b0d9e826e4e7e63a3ae61553137a3f9d280)]:
  - @valbuild/ui@0.136.10
  - @valbuild/server@0.136.10
  - @valbuild/shared@0.136.10
  - @valbuild/mcp@0.136.10
  - @valbuild/react@0.136.10
  - @valbuild/language-server@0.136.10

## 0.136.9

### Patch Changes

- Updated dependencies [[`c2bd7e7`](https://github.com/valbuild/val/commit/c2bd7e7e537f00a269a54b72274fe5efb81c0ae9)]:
  - @valbuild/ui@0.136.9
  - @valbuild/react@0.136.9
  - @valbuild/server@0.136.9
  - @valbuild/language-server@0.136.9
  - @valbuild/mcp@0.136.9

## 0.136.8

### Patch Changes

- Updated dependencies [[`35577be`](https://github.com/valbuild/val/commit/35577be50981fec35fc27ee9435a092a26909395)]:
  - @valbuild/core@0.136.8
  - @valbuild/ui@0.136.8
  - @valbuild/language-server@0.136.8
  - @valbuild/mcp@0.136.8
  - @valbuild/react@0.136.8
  - @valbuild/server@0.136.8
  - @valbuild/shared@0.136.8

## 0.136.7

### Patch Changes

- Updated dependencies [[`5f7a4a5`](https://github.com/valbuild/val/commit/5f7a4a5f86dfe4581fbfb402059bba70e029afdc)]:
  - @valbuild/ui@0.136.7
  - @valbuild/react@0.136.7
  - @valbuild/server@0.136.7
  - @valbuild/language-server@0.136.7
  - @valbuild/mcp@0.136.7

## 0.136.6

### Patch Changes

- Updated dependencies [[`562713a`](https://github.com/valbuild/val/commit/562713a2e972e603abb43259f40ccfbf06990fe5)]:
  - @valbuild/ui@0.136.6
  - @valbuild/react@0.136.6
  - @valbuild/server@0.136.6
  - @valbuild/language-server@0.136.6
  - @valbuild/mcp@0.136.6

## 0.136.5

### Patch Changes

- Updated dependencies [[`28a71c3`](https://github.com/valbuild/val/commit/28a71c3beb40d15d628b99959c5161cee09d1871)]:
  - @valbuild/ui@0.136.5
  - @valbuild/react@0.136.5
  - @valbuild/server@0.136.5
  - @valbuild/language-server@0.136.5
  - @valbuild/mcp@0.136.5

## 0.136.4

### Patch Changes

- Updated dependencies [[`d19b1f6`](https://github.com/valbuild/val/commit/d19b1f67360b057e63536ac020f7109bd2496389)]:
  - @valbuild/ui@0.136.4
  - @valbuild/react@0.136.4
  - @valbuild/server@0.136.4
  - @valbuild/language-server@0.136.4
  - @valbuild/mcp@0.136.4

## 0.136.3

### Patch Changes

- [#726](https://github.com/valbuild/val/pull/726) [`3b19534`](https://github.com/valbuild/val/commit/3b19534bb7aa16452a104906d9594083c3bc3e89) Thanks [@freekh](https://github.com/freekh)! - A Studio publish of a project with no repository now ships every edit that was saved, and keeps the site styled.

  - A host that embeds the project's source can hand it to Val as `projectSource` (`initValServer(..., { http: { projectSource } })`). A publish then patches that text, not text fetched from the content service at a commit, which a project with no repository does not have. The build platform's wiring passes the build's own source, so `.val.ts` can be rendered for a project made on `/new`. Before, its first save produced no files, and the build that followed carried none of the save's edits.
  - New route `GET /api/val/built-source`: the `.val.ts` text of every module changed since the running build, with every commit since it applied. The Studio builds from it, so an edit whose own publish failed, and a Finish publishing, are no longer left out of the next build.
  - A Studio build that compiles no stylesheet (a browser cannot run Tailwind `@plugin`s) keeps the live site's. A Studio save never changes a stylesheet or a component, so the live CSS is still the right one.

- Updated dependencies [[`38d24f7`](https://github.com/valbuild/val/commit/38d24f723639ee109d1007854507c4571bc82575), [`3b19534`](https://github.com/valbuild/val/commit/3b19534bb7aa16452a104906d9594083c3bc3e89), [`fa28164`](https://github.com/valbuild/val/commit/fa28164dfd1e05ff53eccf375334741d857fd2ef)]:
  - @valbuild/ui@0.136.3
  - @valbuild/server@0.136.3
  - @valbuild/shared@0.136.3
  - @valbuild/react@0.136.3
  - @valbuild/language-server@0.136.3
  - @valbuild/mcp@0.136.3

## 0.136.2

### Patch Changes

- Updated dependencies [[`f76cd56`](https://github.com/valbuild/val/commit/f76cd56b9f1c1bcc0a608a7a4de24b1e776adccb)]:
  - @valbuild/ui@0.136.2
  - @valbuild/server@0.136.2
  - @valbuild/shared@0.136.2
  - @valbuild/react@0.136.2
  - @valbuild/language-server@0.136.2
  - @valbuild/mcp@0.136.2

## 0.136.1

### Patch Changes

- [#697](https://github.com/valbuild/val/pull/697) [`5c82928`](https://github.com/valbuild/val/commit/5c82928992d29f133f81cf0704a273c0449b18f1) Thanks [@freekh](https://github.com/freekh)! - Read draft content once per request instead of once per `fetchVal`

  In draft mode, `fetchVal` resolves its selector by asking the Val server for the
  whole module tree. It did that on every call, so a page with three reads made
  three requests for three identical answers — and `fetchValRouteUrl` added a
  fourth by calling `fetchVal` again on top of the caller's own. The answer cannot
  differ between reads in one request, so it is now read once and shared. On a
  60-module project a three-read draft render goes from ~187ms to ~70ms.

  The memo is scoped to the request and nothing wider, because the response it
  holds contains the caller's own unpublished patches: React's `cache()` in a
  Next RSC, a `WeakMap` keyed on the `Request` in TanStack Start, and no caching
  at all where neither is available.

  What this does **not** change:

  - **Production is untouched.** With Val disabled the reader never calls the
    server; it resolves against the statically imported module, as before.
  - **What a draft shows is unchanged.** Same query, same patch scoping — a draft
    still shows the caller's own staged work and nobody else's.
  - **The client readers are untouched.** `useVal` already subscribed to exactly
    the modules its selector names.
  - **The server still evaluates every module per request.** Narrowing the
    request's path was measured and does not help: `/sources/~` evaluates,
    previews and validates everything and only then filters the response, so a
    narrow path returns less for the same milliseconds. That remains open.

- Updated dependencies [[`cf89e74`](https://github.com/valbuild/val/commit/cf89e7429a79c4304ecbedd4f8b571a0de0f145f), [`c219574`](https://github.com/valbuild/val/commit/c21957498f3c7f4f47cef197c5dc0d591aa744ca), [`e673b43`](https://github.com/valbuild/val/commit/e673b43feaf48b7f30881d6786c858a0cb6a44a2), [`5c82928`](https://github.com/valbuild/val/commit/5c82928992d29f133f81cf0704a273c0449b18f1), [`4450be5`](https://github.com/valbuild/val/commit/4450be570ec3a66d7d98ba273c333ca2d2f163d9), [`d2f385a`](https://github.com/valbuild/val/commit/d2f385a04978992a5036379235e447ba7775faef)]:
  - @valbuild/ui@0.136.1
  - @valbuild/shared@0.136.1
  - @valbuild/server@0.136.1
  - @valbuild/core@0.136.1
  - @valbuild/react@0.136.1
  - @valbuild/language-server@0.136.1
  - @valbuild/mcp@0.136.1

## 0.136.0

### Patch Changes

- Updated dependencies [[`f3a4bb7`](https://github.com/valbuild/val/commit/f3a4bb7aea604943b92545c122243798c759715c), [`1d72d00`](https://github.com/valbuild/val/commit/1d72d00a1b036959ae0f1540121701cbb2694dcb)]:
  - @valbuild/ui@0.136.0
  - @valbuild/core@0.136.0
  - @valbuild/server@0.136.0
  - @valbuild/shared@0.136.0
  - @valbuild/language-server@0.136.0
  - @valbuild/react@0.136.0
  - @valbuild/mcp@0.136.0

## 0.135.0

### Patch Changes

- [#707](https://github.com/valbuild/val/pull/707) [`c9affec`](https://github.com/valbuild/val/commit/c9affece6ae6ba62bd6c1113ed1fdab6317fa112) Thanks [@freekh](https://github.com/freekh)! - `val validate --fix` now formats with your prettier config instead of prettier's defaults

  `--fix` formatted the files it repaired by calling `prettier.format(code, { filepath })`, which never reads `.prettierrc`: `filepath` picks the parser and nothing else — only `resolveConfig`, `getFileInfo` and prettier's own CLI consult the config. On a project whose style is not prettier's default, a two-line content fix therefore arrived as a whole-file rewrite, and in a repo with a format check in CI it turned a content fix into a red build.

  There is now one implementation of "format a written file the way this project does", `createPrettierFormatter`, exported from `@valbuild/server` and re-exported by `@valbuild/next/server` and `@valbuild/tanstack/server`. It resolves `.prettierrc` for each file (including any `overrides` that match it), leaves anything in `.prettierignore` untouched, and falls back to prettier's defaults when the project has no config. `val validate --fix` uses it, so the CLI and the Studio can no longer disagree about formatting.

  Use it for your app's `formatter` too — this is the recommended setup, and it replaces reading `.prettierrc.json` by hand:

  ```ts
  import prettier from "prettier";
  import {
    initValServer,
    createPrettierFormatter,
  } from "@valbuild/next/server";

  const { valNextAppRouter } = initValServer(
    valModules,
    { ...config },
    {
      draftMode,
      formatter: createPrettierFormatter(prettier, {
        projectRoot: process.cwd(),
      }),
    },
  );
  ```

  Existing `formatter` callbacks keep working unchanged.

- Updated dependencies [[`c9affec`](https://github.com/valbuild/val/commit/c9affece6ae6ba62bd6c1113ed1fdab6317fa112), [`72a7ca7`](https://github.com/valbuild/val/commit/72a7ca78354fff00e37a51359b17fba9334dc5e6)]:
  - @valbuild/server@0.135.0
  - @valbuild/language-server@0.135.0
  - @valbuild/mcp@0.135.0

## 0.134.1

### Patch Changes

- Updated dependencies [[`821e789`](https://github.com/valbuild/val/commit/821e789c1af47510af5d23eb96384ff78ddd7646)]:
  - @valbuild/shared@0.134.1
  - @valbuild/language-server@0.134.1
  - @valbuild/mcp@0.134.1
  - @valbuild/react@0.134.1
  - @valbuild/server@0.134.1
  - @valbuild/ui@0.134.0

## 0.134.0

### Minor Changes

- [#690](https://github.com/valbuild/val/pull/690) [`16c49ea`](https://github.com/valbuild/val/commit/16c49ea6dd97c7a96bbfdf211af9bab5884579e2) Thanks [@freekh](https://github.com/freekh)! - Read a view with `useVal` / `fetchVal`.

  A `s.view()` field reads as a pointer with no properties on it. It can now be handed to a reader, which resolves it to the module it names:

  ```tsx
  const page = useVal(pageVal);
  const header = useVal(page.header); // the header module's content, typed
  ```

  The point is single source of truth rather than a new capability: the page declares which module it shows, and a component follows that declaration instead of importing the target a second time. Change `s.view(headerVal)` to `s.view(navVal)` and the reader follows; an import would have kept reading the header.

  The readers that take a MODULE rather than a value follow the same rule — `useValKey`, `useValRoute`, `useValRouteUrl` and the `fetchVal*` counterparts, in both the Next and TanStack packages:

  ```tsx
  const page = useVal(pageVal);
  const note = useValRoute(page.notes, params); // the router module the view names
  ```

  Works in draft mode, including when the page itself has a pending edit. Two things to know:

  - **Resolve a handle in the component that read the module containing it.** A handle carries the module it points at, and that cannot survive serialization — so one passed from a server component to a client component as a prop arrives empty. It throws with an explanation rather than handing back the pointer. This is why it throws rather than returning nothing: every one of the route and key readers already uses `null` / `undefined` to mean "no such entry", so a quiet answer would be indistinguishable from a 404.
  - **`ValView<Source>` is now a member of `SelectorSource`**, since a reader accepts one.

### Patch Changes

- [#708](https://github.com/valbuild/val/pull/708) [`be78a9b`](https://github.com/valbuild/val/commit/be78a9b51678439f7ecb1c7f3887f9e8e1261a13) Thanks [@freekh](https://github.com/freekh)! - Fix `gitCommit` and `gitBranch` in `val.config.ts` never reaching the server,
  and make them the one way to say it.

  `val.config.ts` has had `gitCommit` and `gitBranch` for as long as it has had
  anything, and a deployed app that set them resolved to no repository at all.
  Nothing failed and nothing was logged: the commit was simply never sent, and
  every patch the project saved recorded none.

  ```ts
  // val.config.ts — the normal Vercel shape, and it did nothing
  initVal({
    project: "org/project",
    gitCommit: process.env.VERCEL_GIT_COMMIT_SHA,
    gitBranch: process.env.VERCEL_GIT_COMMIT_REF,
  });
  ```

  The two halves never met. The server wanted a nested
  `git: { commit, branch }`, `val.config.ts` offered two flat keys, and nothing
  mapped one onto the other — so the only thing that worked was
  `VAL_GIT_COMMIT` / `VAL_GIT_BRANCH` in the environment.

  Rather than teach the server to read both, the nested option is gone:
  `ValApiOptions` and TanStack's `ValHttpMode` now take `gitCommit` and
  `gitBranch`, the same two names `ValConfig` uses. There is one name for this
  now, wherever it is set. The framework bindings already hand the server
  `{ versions, ...config }`, so a project's config keys arrive with nothing to
  map, and a host passing them directly is saying the same thing in the same
  words.

  Flat because of where these values come from. A platform supplies them as
  `process.env.VERCEL_GIT_COMMIT_SHA` and friends, typed `string | undefined`,
  and two optional strings take that as it comes — a nested object makes every
  caller write the ternary that turns two maybe-strings into one maybe-object.

  **Breaking for a host that passed `git` itself**, which is the nested option on
  `ValApiOptions` and on TanStack's `http` mode. An app that only configures
  `val.config.ts` or the environment is unaffected.

  ```ts
  // before
  initValServer(valModules, config, {
    http: { apiKey, valSecret, git: { commit, branch } },
  });

  // after
  initValServer(valModules, config, {
    http: { apiKey, valSecret, gitCommit: commit, gitBranch: branch },
  });
  ```

  **What a commit is for**, and why its absence is worth a release rather than a
  shrug: publishing turns pending patches into new `.val.ts` text, and to patch a
  file you must first read it — at a commit. A project with none is a project
  whose publishes read whatever the content service last had, rather than the
  revision the deployed code was built from.

  **One more behaviour change.** A commit and a branch have always been taken
  together or not at all, and that check now sees config-supplied values too. A
  project that sets exactly one of `gitCommit` and `gitBranch` used to have both
  quietly ignored and will now be refused at startup, naming the missing half.
  That is the configuration that would otherwise fail later, at a publish.

- Updated dependencies [[`be78a9b`](https://github.com/valbuild/val/commit/be78a9b51678439f7ecb1c7f3887f9e8e1261a13), [`1c31dcc`](https://github.com/valbuild/val/commit/1c31dcca7f1bb0199350567fd579de29f48bb26d), [`688b9e3`](https://github.com/valbuild/val/commit/688b9e36b821323cda6870cdff03dd36ec3e782f), [`16c49ea`](https://github.com/valbuild/val/commit/16c49ea6dd97c7a96bbfdf211af9bab5884579e2), [`eaa265e`](https://github.com/valbuild/val/commit/eaa265e78d9f6d2a1b685c38901612b8a3704eed)]:
  - @valbuild/server@0.134.0
  - @valbuild/ui@0.134.0
  - @valbuild/core@0.134.0
  - @valbuild/react@0.134.0
  - @valbuild/shared@0.134.0
  - @valbuild/language-server@0.134.0
  - @valbuild/mcp@0.134.0

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

- Updated dependencies [[`2b9a51b`](https://github.com/valbuild/val/commit/2b9a51b7dbe2dff53b7686a4f3b7eb9bc5784fae), [`802412b`](https://github.com/valbuild/val/commit/802412b92c06bc1abbca78c86885e39c8710dd83)]:
  - @valbuild/ui@0.133.0
  - @valbuild/server@0.133.0
  - @valbuild/shared@0.133.0
  - @valbuild/react@0.133.0
  - @valbuild/language-server@0.133.0
  - @valbuild/mcp@0.133.0

## 0.132.1

### Patch Changes

- Updated dependencies [[`c9a5cd3`](https://github.com/valbuild/val/commit/c9a5cd3a4ab5908ecb9757b7a95db17a77e3b173), [`f413c5c`](https://github.com/valbuild/val/commit/f413c5cebca27ba82052825abc8c632b6177747e), [`1ddf245`](https://github.com/valbuild/val/commit/1ddf245ec73ad5af8099c3d18d4d33c6a1cc1254), [`a19997a`](https://github.com/valbuild/val/commit/a19997a542e65cc1375837b1bdb11c8af9e10160), [`c07b1ab`](https://github.com/valbuild/val/commit/c07b1abe30e226c80ef7ec4b4f0f5ccdae061c11), [`76c5d41`](https://github.com/valbuild/val/commit/76c5d41c3afa7cc8180d156c9e19fb082af7fba4), [`cbfa2b8`](https://github.com/valbuild/val/commit/cbfa2b884898f1603bde8e5aa5cd9da78778101f), [`f2ac188`](https://github.com/valbuild/val/commit/f2ac1887c11397b597081eef7206063b52b21c5b), [`003419a`](https://github.com/valbuild/val/commit/003419ab72f3069d92e67dfea931d5accc63e730)]:
  - @valbuild/ui@0.132.1
  - @valbuild/server@0.132.1
  - @valbuild/language-server@0.132.1
  - @valbuild/react@0.132.1
  - @valbuild/mcp@0.132.1

## 0.132.0

### Minor Changes

- [#689](https://github.com/valbuild/val/pull/689) [`c1c93c1`](https://github.com/valbuild/val/commit/c1c93c1431072b37b4098bcdc49ebe207e3a28d5) Thanks [@freekh](https://github.com/freekh)! - `initValContent` takes an `http` option, so the content readers can be put in
  http mode.

  They build a Val server of their own — they resolve content by asking it, not by
  calling the API over HTTP — so the mode question is put to them separately.
  `initValServer` has had `http` for a while; these readers did not, which meant a
  host could configure its API for http mode and leave the half of Val that
  renders its pages inferring a mode instead. Where the credentials are handed to
  Val in code rather than through the environment there is nothing to infer from,
  because `process.env.VAL_API_KEY` is undefined in a bundle built separately from
  its dependencies.

  Pass the same object both halves get. `gitCommit` is the field that is silently
  wrong rather than loudly missing: every read in this mode fetches the module's
  path from the content service at that commit, so readers given a different one
  from the API resolve a different version of the same file — a draft render
  showing content that is neither the draft nor what the site serves, with nothing
  failing anywhere.

### Patch Changes

- [#689](https://github.com/valbuild/val/pull/689) [`d0d684b`](https://github.com/valbuild/val/commit/d0d684bdd62d2d9a2cddff38beadf9175f55bf91) Thanks [@freekh](https://github.com/freekh)! - A probe for the seams a host that BUILDS rather than deploys depends on.

  `examples/tanstack/scripts/hostPublishProbe.ts` configures both halves of Val in
  `http` mode and drives a publish through `publishOverride`, against
  `e2e/mock-content-host`. Nothing exercised those two together: `e2e/http/` drives
  the Studio, and `publishOverride` has no UI to drive it from.

  What it pins is the ordering. A host whose publish is a build must commit
  _first_ — building first hands its builder content the content service does not
  have yet, so every read in the new build resolves the commit from before the
  save, and the site shows pre-save content with the edits already consumed, with
  nothing failing to say so.

  No product code changed.

- Updated dependencies [[`72cc676`](https://github.com/valbuild/val/commit/72cc6765e92a6e72b5c09ddd9eed8efa7ce899f2)]:
  - @valbuild/server@0.132.0
  - @valbuild/language-server@0.132.0
  - @valbuild/mcp@0.132.0

## 0.131.0

### Minor Changes

- [#686](https://github.com/valbuild/val/pull/686) [`0d5857b`](https://github.com/valbuild/val/commit/0d5857b731e11f7e6a011f79297df6485908c31f) Thanks [@freekh](https://github.com/freekh)! - Say `VAL_MODE=memory` where there is no disk, and get a sentence instead of an `EPERM`

  Memory mode — the one for a host that holds the project's source itself — is
  selected by passing `sourceFiles`, and it has to be: nothing in an environment
  can supply a project's source, so a mode that an env var could switch on would
  be a server with no content in it.

  The cost was the failure when a host forgot. Val inferred `fs` mode, `fs` mode
  went looking for a working tree, and in a Worker isolate the first thing to
  touch the disk failed:

  ```
  patch-error /bundle/.val/patches.lock: EPERM
  ```

  That names a path two layers below the decision that caused it, and nobody
  reading it would guess "your server was configured for the wrong mode".

  So an environment can now DECLARE that it has no disk:

  ```
  VAL_MODE=memory
  ```

  It does not turn memory mode on. It says the host is supposed to be supplying
  `sourceFiles`, so if none arrive, Val refuses at configuration time and says
  where to pass them. `VAL_MODE=` counts as unset, the way a shell means it; any
  other value is refused rather than ignored, since leaving you in `fs` mode is
  the exact failure this is meant to catch.

  **`initValContent` takes the same options, and this is the release that
  noticed.** It builds a Val server of its own — these readers resolve content by
  asking it, not by calling the API over HTTP — so configuring `initValServer`
  alone left them inferring `fs` mode. On a host with no filesystem that is a
  reader looking for a working tree that is not there; it went unnoticed because
  published reads still worked.

  ```ts
  const patchStore = new InMemoryPatchStore(); // now exported from this package

  const { valApiHandler, draftMode } = initValServer(valModules, config, {
    sourceFiles: FILES,
    patchStore,
    unsafelyAllowUnauthenticated: true,
  });

  const { fetchValStega } = initValContent(config, valModules, {
    draftMode,
    // The same three. Two patch stores are two sets of pending edits, and a
    // reader that checks a session the host never issues answers itself 401 and
    // falls back to published content — a draft render showing the live site.
    sourceFiles: FILES,
    patchStore,
    unsafelyAllowUnauthenticated: true,
  });
  ```

  All three are optional. Left out, this reader gets its own store and its own
  answer about authentication, which is right for published content.

  `@valbuild/next` has no memory mode: its `initValServer` takes neither option,
  so for a Next app `VAL_MODE=memory` names an environment Val cannot serve from,
  and the error says so.

  Nothing changes for an app that sets none of this: `http` when `VAL_API_KEY`
  and `VAL_SECRET` are both present, `fs` otherwise, as before.

### Patch Changes

- Updated dependencies [[`0d5857b`](https://github.com/valbuild/val/commit/0d5857b731e11f7e6a011f79297df6485908c31f)]:
  - @valbuild/server@0.131.0
  - @valbuild/language-server@0.131.0
  - @valbuild/mcp@0.131.0

## 0.130.0

### Minor Changes

- [#684](https://github.com/valbuild/val/pull/684) [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75) Thanks [@freekh](https://github.com/freekh)! - A third ValOps mode, for a host that already holds its own source

  EXPERIMENTAL. `fs` mode assumes a working tree it can watch and write; `http`
  mode assumes Val's content service owns the patch chain and that a commit is a
  git commit. A host that builds and publishes its own output is neither: it holds
  the source already, it has nowhere to watch, and its "commit" is a new build.

  Forcing such a host into `fs` mode cost three things, all now fixed: `/stat`
  long-polled against watchers that could never fire, burning CPU for the whole
  hold to learn nothing;
  `/api/val/enable` 500'd; and every read of a `.val.ts` went through a shimmed
  filesystem when the host could simply hand the source over.

  `ValOpsMemory` takes the source as `sourceFiles`, refuses the local binary
  members by name — this configuration uses Val's remote files — and answers the
  history members with the same closed `not-supported-in-fs-mode` error `ValOpsFS`
  gives, so the History UI degrades the way it already knows how rather than
  inventing a commit list.

  `getStat` still long-polls -- the hold is what paces the client, and an earlier
  version that answered immediately turned a 20-second poll into a request every
  6ms -- but it parks on a SIGNAL rather than a timer. This mode owns its store,
  so it is told when something changes: no timers while parked, and a patch
  written by another tab is seen at once rather than up to 250ms later.

  Two seams come with it. `commitPrepared` lets a host take what a save produced
  instead of a git commit, and `publishOverride` lets a publish be something other
  than a push. Both are opt-in; an app that sets neither behaves exactly as before.

  The in-memory patch store is explicitly **not durable**. It is behind
  `ValPatchStore`, so a durable implementation is a swap rather than a rewrite,
  but as shipped a restart loses unpublished patches.

  **Memory mode authenticates.** `ValOps` gained `requiresAuth` alongside
  `patchesAreLocal`, because one flag was answering two questions: whether a store
  auto-saves or publishes (behaviour, reported as `mode` and keyed off by the UI),
  and whether an unauthenticated request may write (security). With two
  implementations the answers coincided — `fs` is a developer's own machine where
  no credential exists, `http` is remote — so `getAuth` was written against
  `patchesAreLocal` and returned anonymous _success_ for a missing cookie, an
  invalid JWT, an unparseable payload, or no configured secret.

  Memory mode splits them: its store is local, and it runs deployed. It therefore
  requires a verified session, like `http` mode. A host that authorises requests
  before Val sees them can opt out with `unsafelyAllowUnauthenticated`, which is
  spelled that way on purpose and warns at startup. `fs` mode is unchanged.

  Val's own MCP endpoint refuses memory mode outright. It has the same absence fs
  mode has — no credential, no backend, every permission check on the far side of
  one — and unlike fs mode it is meant to run deployed, so the existing
  "development only" and loopback guards refuse nothing. A host in this mode owns
  its own trust boundary and can offer the tools through it.

  Internally, the routes' `instanceof ValOpsFS` checks meant "is this a local
  store" — correct with two implementations and silently wrong with three. They are
  now `ValOps.patchesAreLocal` at all 17 policy sites.

### Patch Changes

- [#684](https://github.com/valbuild/val/pull/684) [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75) Thanks [@freekh](https://github.com/freekh)! - `@valbuild/tanstack` can be bundled for a browser again

  The root entry — the one every client component imports — reached TanStack
  Start's server module from inside `isValEnabled`:

  ```js
  const { getCookie } = await import("@tanstack/react-start/server");
  ```

  At runtime that is already correct anywhere but a server: the import fails, the
  `catch` returns `false`, which is what the function's documentation says it does.
  Under Vite the dynamic form also keeps it out of the client bundle.

  It does not everywhere. A host that bundles this package ahead of time and audits
  what each chunk imports sees a dynamically imported chunk as a chunk like any
  other — and this one reaches Start's SSR path and lands on `node:stream`. The
  package could not be built for a browser or a Cloudflare Worker at all, which
  made every component importing it unusable there.

  The edge is now inverted. The root entry holds a slot, `@valbuild/tanstack/server`
  fills it on import with the implementation that was already there, and the root
  entry no longer names TanStack's server module. Nothing changes for an app that
  imports `/server`, which is every app with a Val API. An `isValEnabled()` call
  before `/server` is first imported returns `false` — the same answer the old
  implementation's `catch` gave in that situation.

- Updated dependencies [[`be1e8be`](https://github.com/valbuild/val/commit/be1e8bee673207596b3eb3d9a9886b8ade9b332f), [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75), [`8425378`](https://github.com/valbuild/val/commit/8425378c315ea46b5d822f1130b633e0449ff1b0), [`7d13dbc`](https://github.com/valbuild/val/commit/7d13dbced9ea49d8243b6b6cf9854cd1a259501f), [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75), [`07db94c`](https://github.com/valbuild/val/commit/07db94c23b73c8c0b2b50a30a89926823c2da1d6), [`473a185`](https://github.com/valbuild/val/commit/473a185f70351b44388f3bc1852649e2c1dbe001), [`64f0de3`](https://github.com/valbuild/val/commit/64f0de339b8621cb5a6c422dfe55cae5b2bbe2a0), [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75)]:
  - @valbuild/ui@0.130.0
  - @valbuild/server@0.130.0
  - @valbuild/mcp@0.130.0
  - @valbuild/core@0.130.0
  - @valbuild/react@0.130.0
  - @valbuild/language-server@0.130.0
  - @valbuild/shared@0.130.0

## 0.129.0

### Patch Changes

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

- Updated dependencies [[`e20f6fb`](https://github.com/valbuild/val/commit/e20f6fbcc215c310eef49a44c1a592c1e2081613), [`7d34ecc`](https://github.com/valbuild/val/commit/7d34ecce787a0709025ae7b4764cb6c3ad1f766b), [`0c351c4`](https://github.com/valbuild/val/commit/0c351c4f97ae7f09772eab0e856ae69821b803b7), [`41a0d76`](https://github.com/valbuild/val/commit/41a0d76636a2dce3f1e506d93170d97e46041d98), [`9e0ebb0`](https://github.com/valbuild/val/commit/9e0ebb00430f05ef92dff031309f73b8075a7d99)]:
  - @valbuild/ui@0.129.0
  - @valbuild/core@0.129.0
  - @valbuild/shared@0.129.0
  - @valbuild/react@0.129.0
  - @valbuild/server@0.129.0
  - @valbuild/language-server@0.129.0
  - @valbuild/mcp@0.129.0

## 0.128.0

### Patch Changes

- Updated dependencies [[`8b52b33`](https://github.com/valbuild/val/commit/8b52b33e1f629f14f66cc71dcc7cf415d210c7d4), [`362fb49`](https://github.com/valbuild/val/commit/362fb49f30d2b04c4ff78d54dca2bf5ad978a05c), [`c595799`](https://github.com/valbuild/val/commit/c59579977a436ec530c6c69f2b340ab9829d97ab)]:
  - @valbuild/core@0.128.0
  - @valbuild/language-server@0.128.0
  - @valbuild/mcp@0.128.0
  - @valbuild/react@0.128.0
  - @valbuild/server@0.128.0
  - @valbuild/shared@0.128.0
  - @valbuild/ui@0.127.0

## 0.127.0

### Patch Changes

- Updated dependencies [[`7fa8699`](https://github.com/valbuild/val/commit/7fa869974bc895af992a7d5c18b76253636d7d65), [`600308d`](https://github.com/valbuild/val/commit/600308d0174990ad9f5c417147d160273489c65a), [`5b7fe05`](https://github.com/valbuild/val/commit/5b7fe05cec6365f9cd1de9ba31e65ed4a87edb63), [`88262ac`](https://github.com/valbuild/val/commit/88262ac8db068650a664981ef73556457d87741a), [`7072e07`](https://github.com/valbuild/val/commit/7072e07623c953a09ac14388ae22dada0b431ce3), [`29811c3`](https://github.com/valbuild/val/commit/29811c3f8c7e001a950e6f4833af6888e6a4efea), [`9983116`](https://github.com/valbuild/val/commit/99831164c5151aad7ca69de79e1d0d59878be251)]:
  - @valbuild/core@0.127.0
  - @valbuild/shared@0.127.0
  - @valbuild/ui@0.127.0
  - @valbuild/server@0.127.0
  - @valbuild/react@0.127.0
  - @valbuild/language-server@0.127.0
  - @valbuild/mcp@0.127.0

## 0.126.0

### Patch Changes

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

- [#661](https://github.com/valbuild/val/pull/661) [`171208a`](https://github.com/valbuild/val/commit/171208a20177e68ed5a8b1a6fdaabfe893a6aa5f) Thanks [@freekh](https://github.com/freekh)! - Every schema method now has a worked `@example` in its JSDoc, so hovering it in
  your editor shows what to write.

  That covers the whole builder surface — `.describe()`, `.validate()`,
  `.nullable()`, `.readonly()`, `.hidden()`, `.preview()`, `.render()`, and the
  per-type methods such as `.minLength()`, `.regexp()`, `.raw()`, `.multiline()`,
  `.from()` / `.to()`, `.remote()`, `.jsonValues()` and `.external()` — as well as
  `c.define()`, `c.json()`, `c.external()` and the `val` helpers (`val.attrs`,
  `val.raw`, `val.unstable_getPath` and friends).

  One of the examples corrected a real trap: a custom validator returns
  `false | string`, so the natural-looking

  ```ts
  s.string().validate((val) => val.trim() === val || "No surrounding spaces");
  ```

  does not type check — `||` yields `true`, and `true` is not one of the two
  answers. Write it as a ternary instead:

  ```ts
  s.string().validate((val) =>
    val.trim() === val ? false : "No surrounding spaces",
  );
  ```

  The examples are checked in CI, not just written: one test asks the TypeScript
  checker for the doc each method actually resolves to and fails if it has no
  `@example`, and another compiles every example it finds.

- Updated dependencies [[`719ad6b`](https://github.com/valbuild/val/commit/719ad6b607bcf136d0dbde9e90bf4b8a843561a4), [`9830277`](https://github.com/valbuild/val/commit/9830277e9aaca8da3030f629c2656ec58da47e45), [`64bfd0a`](https://github.com/valbuild/val/commit/64bfd0a6c85832ea5169b53e47087f22e193df36), [`7782979`](https://github.com/valbuild/val/commit/7782979e9b52f2015a6e72dc981e630d4f8c78e2), [`5bfd630`](https://github.com/valbuild/val/commit/5bfd630b63dee2189e238f20fe72ecc5537160f7), [`ccbcda6`](https://github.com/valbuild/val/commit/ccbcda60b3e3c465071229ae1ba28ac735483e63), [`f2fe70d`](https://github.com/valbuild/val/commit/f2fe70dab2b65000dfaf289f09c70b4a8291467a), [`5c18c99`](https://github.com/valbuild/val/commit/5c18c99ecc84651f82123481fc042063db953833), [`755e1a3`](https://github.com/valbuild/val/commit/755e1a3953775cb8d2c2dce87d6810d3dc329640), [`c6b1ec8`](https://github.com/valbuild/val/commit/c6b1ec84f1883750a4cfe5f70470b177621e971f), [`656f680`](https://github.com/valbuild/val/commit/656f680043c640f678625a64e690389ab23a0a69), [`610a041`](https://github.com/valbuild/val/commit/610a0414b120b521f38a2eb1182b3778bf778b2b), [`171208a`](https://github.com/valbuild/val/commit/171208a20177e68ed5a8b1a6fdaabfe893a6aa5f)]:
  - @valbuild/ui@0.126.0
  - @valbuild/shared@0.126.0
  - @valbuild/server@0.126.0
  - @valbuild/core@0.126.0
  - @valbuild/react@0.126.0
  - @valbuild/language-server@0.126.0
  - @valbuild/mcp@0.126.0

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

### Patch Changes

- Updated dependencies [[`22f78b4`](https://github.com/valbuild/val/commit/22f78b471fd18e542f518f72b75bd472d7c3dc52), [`c390397`](https://github.com/valbuild/val/commit/c390397cb5e203eb1bedae3a6fab15726e850b90)]:
  - @valbuild/language-server@0.125.0
  - @valbuild/core@0.125.0
  - @valbuild/shared@0.125.0
  - @valbuild/ui@0.125.0
  - @valbuild/mcp@0.125.0
  - @valbuild/react@0.125.0
  - @valbuild/server@0.125.0
