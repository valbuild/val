# @valbuild/shared

## 0.148.2

### Patch Changes

- [#889](https://github.com/valbuild/val/pull/889) [`dc7c8cc`](https://github.com/valbuild/val/commit/dc7c8ccd82f643e662d00225fabec411b5d39e3a) Thanks [@freekh](https://github.com/freekh)! - Val is quieter in your app's console. Errors and warnings you can act on still
  print, now prefixed with `[val]` so you can filter them. Val's own debug
  output, which used to reach your terminal and browser console, is now off by
  default. That includes the `Invalid JWT` line that printed on every request
  with an expired session cookie, the "verifying draft mode" and polling notices,
  and the Studio's sync and WebSocket chatter.

  To turn the debug output back on, for example when reporting a bug:

  - on the server, set `VAL_DEBUG=1`
  - in the browser, run `localStorage.setItem("val:debug", "1")` in the console.
    It takes effect immediately, with no reload. Remove the key to turn it off
    again.

- Updated dependencies [[`dc7c8cc`](https://github.com/valbuild/val/commit/dc7c8ccd82f643e662d00225fabec411b5d39e3a)]:
  - @valbuild/core@0.148.2

## 0.148.0

### Patch Changes

- [#818](https://github.com/valbuild/val/pull/818) [`562d032`](https://github.com/valbuild/val/commit/562d03280c3fcf97a80562e8b017dd2125ac4ad1) Thanks [@freekh](https://github.com/freekh)! - Remote files are now addressed on the host the project's settings name. For a
  project hosted by Val, that is the project's own address, and its remote images
  and files are served from there rather than from `remote.val.build`. Every other
  project is unchanged.

  - The Studio, `val validate --fix` and the MCP image tool all take the host from
    the project's settings, falling back to `remote.val.build` as before.
  - Re-reading a remote file whose recorded size or type is out of date keeps it
    on the host it was on.
  - When a remote file's host cannot be reached, tooling downloads it from the
    project's permanent `<id>.valstart.dev` address instead, and keeps it only if
    its bytes match the file the address names.

- [#818](https://github.com/valbuild/val/pull/818) [`562d032`](https://github.com/valbuild/val/commit/562d03280c3fcf97a80562e8b017dd2125ac4ad1) Thanks [@freekh](https://github.com/freekh)! - Remote files served from a project's own site (addresses like
  `https://www.acme.no/_val/file/…`) are now checked for whether that address
  still serves the project. When a custom domain has been removed or moved to
  another project, the image or file is reported, and **Fix** on the Studio's
  Validate page — or `val validate --fix` — points it at the project's permanent
  `<id>.valstart.dev` address. Nothing is uploaded or downloaded: only the address
  changes.

  Remote file addresses with a `/_val` prefix after the host are now recognised.

- [#818](https://github.com/valbuild/val/pull/818) [`562d032`](https://github.com/valbuild/val/commit/562d03280c3fcf97a80562e8b017dd2125ac4ad1) Thanks [@freekh](https://github.com/freekh)! - Fix existing remote images in rich text being saved as `/publichttps://…`.

  Editing a rich text field could rewrite every remote image already in it into a
  broken path when the field was not set up to upload remote images itself — for
  example before the project's remote file settings had loaded, or when the
  field's image schema is not `.remote()`. A published remote image is now kept
  as it is, whatever host it is on.

- [#818](https://github.com/valbuild/val/pull/818) [`562d032`](https://github.com/valbuild/val/commit/562d03280c3fcf97a80562e8b017dd2125ac4ad1) Thanks [@freekh](https://github.com/freekh)! - **Check everything** on the Studio's Validate page now checks media directories
  (`s.imagedir()`, `s.filedir()`, `s.fontdir()` and `s.videodir()`) by the files
  they list:

  - An entry whose file is gone has a **Fix** that removes it from the directory.
  - An image or file entry whose recorded size or type does not match its file has
    a **Fix** that corrects it from the file, keeping its alt text.
  - A video entry whose file is gone is reported, and is removed by hand: its
    posters and captions may still be in use.
  - A remote entry is checked with its host, like any remote file.

  `val validate --fix` fixes media directories exactly as before.

- [#818](https://github.com/valbuild/val/pull/818) [`562d032`](https://github.com/valbuild/val/commit/562d03280c3fcf97a80562e8b017dd2125ac4ad1) Thanks [@freekh](https://github.com/freekh)! - **Check everything** on the Studio's Validate page now checks remote images and
  files too.

  - A remote image or file whose address no longer matches what is recorded about
    it (its size, type or the schema's options changed since it was uploaded) has
    a **Fix**, which re-reads the file and corrects it, as `val validate --fix`
    does.
  - A remote host that does not answer is shown once, at the top of the page, with
    how many files it holds and a **Try again**, rather than as an error on every
    image.
  - A file its host no longer has is shown at the image or file that uses it.

  Images and files in your unpublished changes are not asked about until they are
  published; the check makes sure the change still has them.

- [#818](https://github.com/valbuild/val/pull/818) [`562d032`](https://github.com/valbuild/val/commit/562d03280c3fcf97a80562e8b017dd2125ac4ad1) Thanks [@freekh](https://github.com/freekh)! - Two new Studio API routes for the full content check, not yet used by the
  Studio's UI:

  - `POST /api/val/validate` checks one module — its content against its schema,
    and its local images and files against their bytes — on the content the
    Studio is showing.
  - `POST /api/val/validate/fix` returns the patch that fixes one of those errors,
    for the Studio to add as a pending change. It builds only the fixes that need
    no disk or remote host: image, file and video metadata, and a view pointing at
    the wrong module.

  Also fixed: an API route whose name started with another route's name could be
  answered by the other route.

- Updated dependencies [[`562d032`](https://github.com/valbuild/val/commit/562d03280c3fcf97a80562e8b017dd2125ac4ad1)]:
  - @valbuild/core@0.148.0

## 0.147.0

### Minor Changes

- [#816](https://github.com/valbuild/val/pull/816) [`2f09cd5`](https://github.com/valbuild/val/commit/2f09cd5e2f4fc37f06917899f24f9ad2ee8d3a8b) Thanks [@freekh](https://github.com/freekh)! - Routers can give each route parameter a schema, and a URL can say which language a page is in.

  - **`s.router(router, params, item)`** takes a schema per route parameter, by the name the route file gives it (`$slug`, `[slug]`, `{-$locale}`). Each key's parameters are validated against them, and a name the route does not have is a schema error.

    ```ts
    s.router(tanstackRouter, { locale: urlLocale, slug: s.string() }, item);
    ```

  - **`s.enum(...).locales({ ... })`** says which of the project's languages each value means, so `/nb/…` can mean `nb-NO`. The tags are checked against `locales.available` in the settings module, like `s.locale()`. On a nullable enum, a second argument names the language of a URL that leaves the segment out, which only a router parameter may use:

    ```ts
    const urlLocale = s
      .enum("nb")
      .nullable()
      .locales({ nb: "nb-NO" }, { null: "en-US" });
    ```

    A router with a locale parameter makes each page a locale scope, so the Studio and validation know which language every page is in.

  - **A route's language segment can no longer be forgotten.** In a project that declares `locales.available`, a page route with a `locale` or `lang` segment (`{-$locale}`, `[lang]`) whose module gives that parameter no schema is reported, saying what to add. Any schema answers it, so a `$lang` that is not a language is silenced with its own, e.g. `{ lang: s.enum("typescript", "python") }`. It is an ordinary validation error: the Studio still opens and `val validate` lists it, but a project that already has such a route will see it after upgrading, and it blocks publishing until the parameter has a schema.
  - **The Studio's new-page form offers a language as a list.** A route parameter whose schema is a locale is picked from the project's languages, each named in its own language, with "no prefix" where the URL may leave the segment out. Other enum parameters get a list of their values, and every parameter's description is shown under it. The URL row previews what the choice puts there.
  - **TanStack optional segments (`{-$param}`)** are now understood: route validation, `useValRoute` and the Studio's new-page form accept keys with and without the segment.

- [#876](https://github.com/valbuild/val/pull/876) [`cb04e58`](https://github.com/valbuild/val/commit/cb04e586db1e3ffd20ec1fee744561b1c8f8cffd) Thanks [@freekh](https://github.com/freekh)! - Demo mode: run the Val Studio with no account and no backend (TanStack Start).

  `<ValApp demo>` starts Val's own server in the visitor's browser tab, and the Studio talks to it there instead of to `/api/val`. Edits show up in the page as they are typed and are held in the tab's memory: nothing is sent anywhere, and a reload starts over. Images and videos can be uploaded too: a small service worker, served by `initValDemoServer()`, hands the upload and the unpublished files to the server in the tab, so an uploaded photo or video shows in the page with nothing leaving the browser. Uploads are capped by their size after encoding. Pair `<ValApp demo>` with `<ValProvider demo>` on the site and `initValDemoServer()` from the new `@valbuild/tanstack/demo` entry on the API route. In a demo the Studio opens with a guided tour, Publish explains what it would do instead of publishing, and Preview in a new tab is shown but disabled.

  Also:

  - `@valbuild/server/browser` is a new entry: Val's request handling, bundleable for a browser. The TypeScript compiler, which only publishing and history need, is loaded when they ask for it, so a browser bundle of the server is about 140 KB rather than 3.6 MB.
  - `s.image({ encode })` now scales an image down in browsers that cannot write WebP (Safari), as a JPEG or PNG in the image's own format, instead of uploading it at full size.
  - `GET /profiles` answers with no profiles, rather than an error, when edits are stored locally and no project is configured.

### Patch Changes

- [#876](https://github.com/valbuild/val/pull/876) [`cb04e58`](https://github.com/valbuild/val/commit/cb04e586db1e3ffd20ec1fee744561b1c8f8cffd) Thanks [@freekh](https://github.com/freekh)! - `s.image({ encode: { type: "webp" } })` now produces WebP in Safari too, including on iPhone and iPad.

  Safari's canvas cannot write WebP, so the Studio used to fall back to a JPEG (or a PNG) there, or to the original file when `accept` allowed only WebP. Now it encodes those images with libwebp, compiled to WebAssembly, at the same quality and size as everywhere else. The encoder is downloaded only by a browser that needs it, once per page, from `content.val.build`, the same place the Studio's bundler is served from. Browsers that can already write WebP never download it. If it cannot be loaded, uploads still work: the image is scaled down as a JPEG or PNG as before, or the original is uploaded.

  A deployment that cannot reach `content.val.build` can serve the encoder itself and point the Studio at it with `globalThis.__VAL_WEBP_SIMD_WASM_URL__` and `globalThis.__VAL_WEBP_WASM_URL__`, the same way `__VAL_ROLLDOWN_WASM_URL__` works for the bundler.

- Updated dependencies [[`2f09cd5`](https://github.com/valbuild/val/commit/2f09cd5e2f4fc37f06917899f24f9ad2ee8d3a8b)]:
  - @valbuild/core@0.147.0

## 0.146.4

### Patch Changes

- [#870](https://github.com/valbuild/val/pull/870) [`81f2e80`](https://github.com/valbuild/val/commit/81f2e803c4cefdf58bbe6856c06e98ace95a8e0b) Thanks [@freekh](https://github.com/freekh)! - The canvas works on a page behind your site's own login.

  A site with its own sign-in (a dashboard, an intranet, a members' area) can be edited in the canvas. The canvas is a frame on the same origin as the Studio, so it sends your site's cookies like any other tab: if you are signed in to the site, the canvas shows the page signed in as you.

  If you were not signed in, the site redirected the canvas to its login page, and the canvas then broke. That page mounted Val's whole overlay inside the canvas, a Studio inside the Studio. The canvas stayed on "Preview is not ready yet" through the sign-in and after it, until you pressed Reload. Now a page shown in the Studio's canvas counts as the canvas wherever it navigated to, so you can sign in inside the canvas and keep editing.

## 0.146.2

### Patch Changes

- [#871](https://github.com/valbuild/val/pull/871) [`e4913e1`](https://github.com/valbuild/val/commit/e4913e1f1178e09987a7c03fd540909ab4b499b0) Thanks [@freekh](https://github.com/freekh)! - An image, file or video picked from a gallery is checked against the gallery as it is now. Picking one uploaded since the site was built (still unpublished, saved in a proposal, or published without a rebuild) used to fail with "The gallery does not have an image at …" and refuse the save. In a proposal, Save now reads "Fix N" and goes to the validation errors instead of being refused by the server, as Publish does on the site.

- [#867](https://github.com/valbuild/val/pull/867) [`04f81ba`](https://github.com/valbuild/val/commit/04f81baeee4a98054c0673ca9fdc34bc5cadacb9) Thanks [@freekh](https://github.com/freekh)! - When a publish breaks a page on a site with proposals, its changes are no longer
  held back on the site: they move into a proposal of their own, with any later
  changes to the same pages, so everyone else keeps publishing. The Studio says
  so — "Publishing broke the site" — and offers **Open the proposal**, where the
  changes can be fixed and published. Sites without proposals hold the changes
  back as before.

- [#867](https://github.com/valbuild/val/pull/867) [`04f81ba`](https://github.com/valbuild/val/commit/04f81baeee4a98054c0673ca9fdc34bc5cadacb9) Thanks [@freekh](https://github.com/freekh)! - Publish only some of your changes: tick them in Review and press **Publish
  selected**. On a site with proposals, Val moves them into a proposal of their
  own and publishes it straight away; everything else stays unpublished, as it
  was.

  Some changes cannot be published apart — two edits to the same list, say — so
  the confirm says what comes with your selection and whose it is before anything
  moves. If the site is published while yours is being prepared, nothing is
  published and you are asked to press it again. If publishing stops after the
  changes have moved, they are safe in their proposal, and Review offers to open
  it as well as to try again.

- Updated dependencies [[`e4913e1`](https://github.com/valbuild/val/commit/e4913e1f1178e09987a7c03fd540909ab4b499b0)]:
  - @valbuild/core@0.146.2

## 0.146.0

### Minor Changes

- [#861](https://github.com/valbuild/val/pull/861) [`89b0fa8`](https://github.com/valbuild/val/commit/89b0fa82a3ae0d8ccd5d0282c1034f1f40cc4e26) Thanks [@freekh](https://github.com/freekh)! - Proposals can be brought up to date with the site, like a pull request.

  - **Update from the site** merges what was published on the site since a proposal started into the proposal, field by field. Where the site and the proposal changed the same field, the Publish dialog shows both and asks which to keep.
  - **With code:** a proposal that changes code, or a site whose code changed since the proposal started, is updated too. The Studio runs each version's schemas in the tab, and the merged code is built before it can be published.
  - Publish offers **Update from the site** whenever the site has moved under the proposal.

- [#864](https://github.com/valbuild/val/pull/864) [`f0c7d27`](https://github.com/valbuild/val/commit/f0c7d27846c21f81ff6ce79c579185150bc0d063) Thanks [@freekh](https://github.com/freekh)! - Patch groups are removed. **Publish** now publishes every pending change, and
  the Review list shows everyone's pending changes in one list. To keep changes
  out of a publish, move them to a proposal.

  Draft reads no longer send `own_patch_groups_only`, `patch_id` or
  `include_patch_groups`, and the server no longer has the patch-group routes or
  fields. A content host that still sends them is fine: they are ignored.

## 0.145.1

### Patch Changes

- [#860](https://github.com/valbuild/val/pull/860) [`a45f595`](https://github.com/valbuild/val/commit/a45f595a5e20b009d4110bbef8ebdc08b2d731d7) Thanks [@freekh](https://github.com/freekh)! - `val publish` and the Studio now tell Val Build which version of the platform's React and TanStack a build was made against. If the platform is updated while a build is running — a project's CI can take several minutes — that build is no longer published onto a platform it was never checked against: the publish stops with a message saying the platform was updated and to build again, and the next build is checked against what it will run on. A build published with `val publish --artifacts` was made elsewhere and does not say, and publishes as before.

## 0.145.0

### Minor Changes

- [#859](https://github.com/valbuild/val/pull/859) [`f085be0`](https://github.com/valbuild/val/commit/f085be0eb5bdc195e9d8cdb15dd5f8acfdabe23c) Thanks [@freekh](https://github.com/freekh)! - An edit Val Build refuses to save because of the project's plan — the Free plan's 1,000 changes a week are used, or a Hosted trial has ended — is now kept in the Studio instead of being reverted.

  - `PUT /patches` answers such a save with a `403` of type `plan-refused`, carrying Val Build's reason and fix as data and which patches of the request it did save. It used to answer `400 patch-error`, which the Studio reads as a bad patch and drops.
  - The Studio keeps the refused edits and any made after them, shows the plan notice with **Upgrade** or **Add a card** beside it, and saves them by itself once the plan allows it: as soon as Val Build says editing is open again (an owner added a card, the week moved on), and otherwise by trying again now and then. A publish or a restore that meets held edits says why, in Val Build's words, instead of suggesting the connection.
  - The MCP write tools answer a refused write as `forbidden`, with Val Build's sentence, instead of `internal`.

### Patch Changes

- [#851](https://github.com/valbuild/val/pull/851) [`b6cb939`](https://github.com/valbuild/val/commit/b6cb9395d8bdcd5182e9c6ba84f5284930de2fa5) Thanks [@freekh](https://github.com/freekh)! - New `s.int()` for whole numbers, `.step()` on `s.int()` and `s.number()`, and a slider for both:

  ```ts
  s.object({
    columns: s.int().min(1).max(6),
    opacity: s
      .int()
      .min(0)
      .max(100)
      .step(5)
      .render({ as: "slider", min: 0, max: 100 }),
    lineHeight: s.number().render({ as: "slider", min: 1, max: 2, step: 0.1 }),
  });
  ```

  - `.min()`, `.max()` and `.step()` are rules the validator checks. A step is counted from `min`, or from 0 when there is none.
  - `.render({ as: "slider", min, max, step? })` is how the field is edited: a slider, with a box beside it for typing an exact value. `min` and `max` are required. The slider's step defaults to the schema's `.step()`, then to 1.
  - The slider can only produce values the schema accepts. A slider outside `.min()`/`.max()`, with a step that is not a multiple of `.step()`, or with decimals on an `s.int()` throws where the schema is defined.
  - A value outside the slider's range is still valid content. The field says it is out of the slider's reach and offers "Set to" the nearest stop. A value that breaks a rule offers "Round to" the nearest allowed value.
  - Fixed: `.min(0)` and `.max(0)` on `s.number()` were ignored.
  - A new item of a number schema starts at the nearest allowed value instead of `0`, so `s.int().min(1)` starts at 1.

- Updated dependencies [[`b6cb939`](https://github.com/valbuild/val/commit/b6cb9395d8bdcd5182e9c6ba84f5284930de2fa5)]:
  - @valbuild/core@0.145.0

## 0.144.9

### Patch Changes

- [#846](https://github.com/valbuild/val/pull/846) [`c44b561`](https://github.com/valbuild/val/commit/c44b5611cf9e557b6b744704703dbff0cb8b23b0) Thanks [@freekh](https://github.com/freekh)! - History is shown for projects hosted by Val Build and inside a proposal, where it lists the proposal's own saves. On the site of a project with proposals, a restore — one field, one module, or "Put everything back" — opens a new proposal with the restored values in it, so it is reviewed there before it is published.

  History also reads a hosted project's first commit, which has no parent: "Go back to this point" failed on it.

  "Go back to this point" on the site brings back the code as well as the content: the proposal it opens stages the files of the build the site served then, and serves that build at once.

## 0.144.5

### Patch Changes

- [#839](https://github.com/valbuild/val/pull/839) [`39e8db3`](https://github.com/valbuild/val/commit/39e8db34cf56c6c43ffff0d3acfe8e0839fa55a9) Thanks [@freekh](https://github.com/freekh)! - A publish that breaks a page no longer stops everyone else publishing. On val.build, the changes it had are held back: the Publish button says how many, and publishes go without them until someone presses Try again or Discard on the failed publish.

  Publish can be pressed while this tab is still building the last publish. The new publish waits its turn and is built when the current one ends.

  Discarding a change that is being published now says so, instead of failing silently. From there you can cancel the publish, which then discards the change, or wait for the publish to end.

## 0.144.4

### Patch Changes

- [#835](https://github.com/valbuild/val/pull/835) [`e70a261`](https://github.com/valbuild/val/commit/e70a261ed8c0938b635214721fc4e445704b1f1f) Thanks [@freekh](https://github.com/freekh)! - A build is now named by what it was built from rather than by what it produced, so publishing the same project files again reuses the build the site already has. When that build is still held, the Studio skips building and uploading it.

## 0.144.2

### Patch Changes

- [#832](https://github.com/valbuild/val/pull/832) [`ab0ea20`](https://github.com/valbuild/val/commit/ab0ea2046e3872c4955f34b363881f76d48d1b1e) Thanks [@freekh](https://github.com/freekh)! - A site served by Val's platform can now be given its content separately from its build. When the platform hands a TanStack app a content version (`VAL_CONTENT`) that differs from what the build bundles, Val renders that content, in the Studio and in draft mode too. It reads it the way it already reads a proposal's saved content.

  Nothing changes for an app that is not given one, and nothing hands one over yet. This is the reading side of publishing content without rebuilding the site.

  A version too large for one environment variable can name others under `refs` (`"env://VAL_CONTENT_1"`), each holding one module's Source or one file's text. Only `refs` is resolved, never a string inside your content, and only variables named `VAL_CONTENT_<n>` are read.

  At a proposal's address, a proposal's saved content is shown over the content version the site serves, so modules the proposal did not change show what the site shows rather than what the build bundles.

  When Val's platform puts a publish live without building the site, because it changed only content, the Studio shows it being checked and going live instead of "Building".

- [#829](https://github.com/valbuild/val/pull/829) [`44a5636`](https://github.com/valbuild/val/commit/44a5636955e005a40f2e6c8544e5cf4378fd0fdf) Thanks [@freekh](https://github.com/freekh)! - Val Studio now shows errors in a gallery's keys, and does not publish them. A remote URL in an `s.imagedir()`, `s.filedir()` or `s.videodir()` gallery that is not `.remote()`, a remote URL that is not valid, or one outside the gallery's directory was hidden in the Studio and did not stop a publish, because it was treated as something saving would repair. Nothing repairs it, so the entry's tile is now marked with the error and publishing waits until it is fixed. `npx val validate` already reports these errors.

## 0.144.0

### Patch Changes

- [#788](https://github.com/valbuild/val/pull/788) [`a84271c`](https://github.com/valbuild/val/commit/a84271c534822071c1e428cf9990602459682d25) Thanks [@freekh](https://github.com/freekh)! - Fixes to `npx val validate` for `s.imagedir()` and `s.filedir()`, and the `s.image(galleryVal)` / `s.file(filesVal)` fields that use them:

  - **`--fix` now updates every field that uses an uploaded image or file.** When `--fix` moves an entry of an `s.imagedir(dir).remote()` or `s.filedir(dir, options).remote()` to Val Remote, the entry's key changes from the local path to the remote URL. Fields that held the old path were left pointing at it, and reported "The gallery does not have an image at …" with nothing to fix it. Now `s.image(galleryVal)` and `s.file(filesVal)` fields, and images in rich text (`s.richtext({ img: s.image(galleryVal) })`), are updated in the same run. The VS Code extension's "upload to Val Remote" updates them in the same edit, including fields inside `.jsonValues()` entries, which live in their own `*.val.json` files.
  - **A field that uses an image or file from a `.remote()` gallery is no longer reported as "Expected local image, but found remote".** The gallery decides whether its files are on Val Remote; the field only has to name a file the gallery has. Before, `--fix` would download the file and point the field at a path the gallery did not have.
  - **Images uploaded through a field into a `.remote()` gallery.** When you upload an image through an `s.image(galleryVal)` field in Val Studio, the field stores the remote URL and the gallery stores the image under its local path. Validation now accepts this, and `useVal` / `fetchVal` now fill in the image's `width`, `height` and `mimeType` from the gallery for it, as they do for every other gallery image.
  - **Errors in a gallery's keys are reported.** A remote URL in a gallery that is not `.remote()`, a remote URL that is not valid, or one outside the gallery's `dir` was silently ignored by `npx val validate`. It is now reported as an error. `--fix` does not change it: you decide whether the key or the gallery's options are wrong.
  - **A file is no longer reported as valid when it still has an error.** When `--fix` fixed one error in a file and another error was left, the file could be printed as "✔ valid".

- Updated dependencies [[`a84271c`](https://github.com/valbuild/val/commit/a84271c534822071c1e428cf9990602459682d25), [`860ab2b`](https://github.com/valbuild/val/commit/860ab2b87333daf95a48215b0e4a1b44f441c878)]:
  - @valbuild/core@0.144.0

## 0.143.0

### Patch Changes

- Updated dependencies [[`f7c25bd`](https://github.com/valbuild/val/commit/f7c25bd4b44c288db8e5ab914e6d8a72c0216ba5), [`729c4ed`](https://github.com/valbuild/val/commit/729c4edfa28f5a2942c435ccf225e65858b080cc)]:
  - @valbuild/core@0.143.0

## 0.142.0

### Patch Changes

- [#805](https://github.com/valbuild/val/pull/805) [`3d2b9e8`](https://github.com/valbuild/val/commit/3d2b9e8c11aa6a4449527e2a1bbb363566797a14) Thanks [@freekh](https://github.com/freekh)! - Proposals in the Studio, for projects on the Val platform that have them turned on: a switcher in the top bar to move between the site and its proposals, New proposal, Rename, Close and All proposals (with Reopen), and — inside a proposal — Save where Publish is, in the proposal's colour. Nothing is shown for a project without proposals. At a proposal's address the server now refuses to publish to the site, so a Save there can never start a site build.

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

- Updated dependencies [[`199e214`](https://github.com/valbuild/val/commit/199e21471d98806fb34c579cb876560078c928b9), [`ba3f330`](https://github.com/valbuild/val/commit/ba3f3300a3dd8649e154097cdfca3b64db209d89)]:
  - @valbuild/core@0.141.0

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

## 0.139.1

### Patch Changes

- [#781](https://github.com/valbuild/val/pull/781) [`5ea70ce`](https://github.com/valbuild/val/commit/5ea70cefde3c74961cfa76b4a5f4c333b850b60a) Thanks [@freekh](https://github.com/freekh)! - Every open Studio now shows the same changes, staged the same way, as a reload would.

  - Staging or unstaging a change in one browser or tab now shows up in your other open Studios right away, without a reload, and publishing from any of them ships the same set.
  - A change you stage before you have made any edit of your own is saved straight away, instead of being kept in the tab until your first edit and lost if you reloaded first.
  - If staging a change fails, the Studio now goes back to showing what is actually saved, instead of keeping the failed change on screen until a reload.

  This needs the Val Build content service released alongside this version.

- Updated dependencies [[`db13bed`](https://github.com/valbuild/val/commit/db13bed902f9f9147feb5be07ce47fe8b5b143f9)]:
  - @valbuild/core@0.139.1

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

### Patch Changes

- Updated dependencies [[`3eb5031`](https://github.com/valbuild/val/commit/3eb503167ae466ee586303c95efcc14665129481)]:
  - @valbuild/core@0.139.0

## 0.138.4

### Patch Changes

- [#770](https://github.com/valbuild/val/pull/770) [`0a885b1`](https://github.com/valbuild/val/commit/0a885b1f0304517b167b959958464066194732d0) Thanks [@freekh](https://github.com/freekh)! - Publishing a Git-connected app-mode project now puts your changes on the site in seconds, instead of waiting for CI.

  - The Studio builds the site in the browser, the same way it does for a managed project. Val pushes the commit to your repository as before. When nothing but content has changed since the build the site is serving, the browser's build goes live right away. If a developer has pushed code in between, the site waits for CI's build, so their code is never taken off the site.
  - If the browser cannot build, the publish still goes through and CI delivers it. This happens when the page is not cross-origin isolated, or when the build keeps failing. Your changes stay visible in the Studio until the site serves a build that has them.
  - Content that would break a page is caught before anything is pushed to your repository.

- [#771](https://github.com/valbuild/val/pull/771) [`58d13a2`](https://github.com/valbuild/val/commit/58d13a2a534421b341b1bf71d02f0a2290fc0d61) Thanks [@freekh](https://github.com/freekh)! - A project created on val.build with a GitHub repository can publish right away. Before, the first publish was refused with "this deployment was not built from one" until the repository's first CI build had finished.

  While that first build runs, the site is served the template's build. When you publish from it, Val now checks that its content files are exactly the same as the files in your repository. If they are, the publish goes ahead and is pushed to your repository straight away. Your changes stay visible in the Studio until the site serves CI's build of them. If the files differ, the publish is refused, as before.

## 0.138.2

### Patch Changes

- [#763](https://github.com/valbuild/val/pull/763) [`2beb226`](https://github.com/valbuild/val/commit/2beb226446c76eb71026f43e04c13943da4a1e31) Thanks [@freekh](https://github.com/freekh)! - When a publish fails because the Studio could not build the site, the editor is now told why. The tab that built it sends its reason with the failed step, so the message reads, for example, "build failed 3 times: Tailwind's '@plugin' is not supported here…" instead of just "build failed 3 times". This needs the content service that accepts the reason; an older one ignores it and shows the message as before.

- [#763](https://github.com/valbuild/val/pull/763) [`443cdcd`](https://github.com/valbuild/val/commit/443cdcdfa8948db22a54adef2ad5e18d9f9868e9) Thanks [@freekh](https://github.com/freekh)! - `val publish` now wires the site at the project's branch, which the content service names, instead of the branch the checkout is on. The site's Val saves its edits to the branch it is wired at, so publishing a managed project from a feature branch made every Studio edit land where no publish looks, and Publish answered "nothing to publish". When the two differ, the CLI says so. With a content service that does not name the branch, the checkout's is used, as before.
- Updated dependencies [[`cf3bbc8`](https://github.com/valbuild/val/commit/cf3bbc8fc89ff349aac5ab101d0b4f28164583e6)]:
  - @valbuild/core@0.138.2

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

### Patch Changes

- Updated dependencies [[`57af895`](https://github.com/valbuild/val/commit/57af8959cc46519a405b1ed7441623f8bf2e6d27), [`5876fe0`](https://github.com/valbuild/val/commit/5876fe075fdee1f76f1cdaa2488ac52c58c894a8)]:
  - @valbuild/core@0.138.0

## 0.137.0

### Minor Changes

- [#676](https://github.com/valbuild/val/pull/676) [`48ac9f0`](https://github.com/valbuild/val/commit/48ac9f06dd59a5b4ca60232b1ef198cf42f23aa6) Thanks [@freekh](https://github.com/freekh)! - A link-check endpoint, so the Studio can find out whether an external page is
  still there.

  `POST /external-urls/check` opens up to twenty URLs and reports what answered:
  the final status after redirects, where it ended up, and how long it took. The
  Studio's Check button in the external pages dialog is the only caller, and it
  cannot do this itself — a cross-origin `fetch` from a browser cannot read a
  response status without CORS headers no ordinary site sends.

  It is an endpoint that makes outbound requests to addresses your content
  supplies, so it is built as one:

  - It is behind the same session check as every other authenticated route —
    which, in fs mode, means the same anonymous access every other route allows
    on a developer's own machine. It is not a new way in; it is the same door.
  - It refuses to connect to anything that is not a public internet address —
    loopback, link-local, the private ranges, the carrier-grade NAT range, and
    the cloud metadata service that hands out instance credentials. The check is
    on the RESOLVED address rather than the hostname, so a name that resolves to
    `127.0.0.1` is refused, and it runs again at every redirect hop.
  - It answers with one generic message for anything it refused, so the endpoint
    cannot be used to find out what a hostname resolves to from inside your
    network. The reason is logged on the server.
  - `HEAD` first, `GET` only where a site answers 405 or 501 to it, and no
    connection reuse between targets.

- [#746](https://github.com/valbuild/val/pull/746) [`e2bfc0e`](https://github.com/valbuild/val/commit/e2bfc0e40383fe25d3ec0473d1032f6264a8939f) Thanks [@freekh](https://github.com/freekh)! - A site hosted on Val (a managed project, with no repository of its own) can now be updated from the Studio. **Settings → Updates** says whether a newer version of the software the site runs on is available, lists the packages that move and their versions, and offers **Update site**.

  Updating rebuilds the site in the browser on the new versions and publishes it through the ordinary publish, so it is checked before it goes live: if the updated site does not render, nothing changes and the site keeps running the old versions. Unpublished changes are kept and are **not** published by an update. After it goes live, reload the Studio to use the new one.

  In Safari, which cannot build the site in the Studio's own page, Update site opens a tab that builds and publishes it, the same way a publish does there, and the Studio follows its progress.

  A Studio that was opened before the site was updated no longer publishes: pressing Publish asks you to reload first, and nothing is saved until you do. Your unpublished changes are kept. Without this, a Studio left open from before an update would have built the site with the previous version of itself.

  The versions come from the template the project was made from, as the platform last built it. A project whose code lives in a repository is not offered this; its dependencies are updated there.

  For hosts: `@valbuild/server` forwards `GET` and `POST /api/val/publish-api/update-target` to the content service, beside `/build-target` and `/project-source`.

### Patch Changes

- [#748](https://github.com/valbuild/val/pull/748) [`beda04b`](https://github.com/valbuild/val/commit/beda04bd326cbab18ed103e8d43917b16f43bd8c) Thanks [@freekh](https://github.com/freekh)! - A save is no longer refused once because an older answer from the server arrived after a newer one. The content service now reports a version of its list of changes, which goes up with every save, discard and publish. The Studio ignores any answer older than one it already has, including the answer to its own last save, discard or publish, so a discarded change can no longer briefly come back, and a published one can no longer briefly show as unpublished.
- Updated dependencies [[`43b58f2`](https://github.com/valbuild/val/commit/43b58f2962840883badf91950da2c51b89d1c7cb)]:
  - @valbuild/core@0.137.0

## 0.136.10

### Patch Changes

- [#743](https://github.com/valbuild/val/pull/743) [`fef29b0`](https://github.com/valbuild/val/commit/fef29b0d9e826e4e7e63a3ae61553137a3f9d280) Thanks [@freekh](https://github.com/freekh)! - Saving no longer gets stuck on "Changes cannot be saved: something else keeps changing them first" when another editor has an unpublished change and later work has been published.

  A new change is now written on top of the latest change the content service has registered, which it reports alongside the list of pending changes, instead of the last change this deployment was shown. Since changes can be published independently, those two can differ for good: an unpublished change can sit before published ones that the running deployment already contains. The Studio and the MCP tools both name the reported head, and fall back to the old behaviour against a content service that does not report one.

## 0.136.8

### Patch Changes

- Updated dependencies [[`35577be`](https://github.com/valbuild/val/commit/35577be50981fec35fc27ee9435a092a26909395)]:
  - @valbuild/core@0.136.8

## 0.136.3

### Patch Changes

- [#726](https://github.com/valbuild/val/pull/726) [`3b19534`](https://github.com/valbuild/val/commit/3b19534bb7aa16452a104906d9594083c3bc3e89) Thanks [@freekh](https://github.com/freekh)! - A Studio publish of a project with no repository now ships every edit that was saved, and keeps the site styled.

  - A host that embeds the project's source can hand it to Val as `projectSource` (`initValServer(..., { http: { projectSource } })`). A publish then patches that text, not text fetched from the content service at a commit, which a project with no repository does not have. The build platform's wiring passes the build's own source, so `.val.ts` can be rendered for a project made on `/new`. Before, its first save produced no files, and the build that followed carried none of the save's edits.
  - New route `GET /api/val/built-source`: the `.val.ts` text of every module changed since the running build, with every commit since it applied. The Studio builds from it, so an edit whose own publish failed, and a Finish publishing, are no longer left out of the next build.
  - A Studio build that compiles no stylesheet (a browser cannot run Tailwind `@plugin`s) keeps the live site's. A Studio save never changes a stylesheet or a component, so the live CSS is still the right one.

## 0.136.2

### Patch Changes

- [#720](https://github.com/valbuild/val/pull/720) [`f76cd56`](https://github.com/valbuild/val/commit/f76cd56b9f1c1bcc0a608a7a4de24b1e776adccb) Thanks [@freekh](https://github.com/freekh)! - A managed project published from the Studio keeps its images, and a project created from a template can publish from the Studio at all.

  - A publish from the Studio carries over every file under `public/` that the site already serves, so the favicon and images no longer disappear after the first Studio publish. When content published the live build, it already holds those files and nothing is uploaded again. When it didn't (a project cloned from a template), the Studio reads them from the site it runs on and builds with them.
  - An image uploaded in the Studio is now part of the build that publishes it. For a managed project, `/save` returns the files the commit wrote (`binaryFiles`), the same way it already returns the `.val.ts` text.
  - `/save` also returns the project's branch for a managed project, and the Studio's build uses it. A project cloned from a template was wired at no commit and no branch, so its first Studio publish went out branchless and the platform refused it.
  - When neither content nor the platform can say which public files the live site serves, the Studio refuses to publish and says so, rather than publishing a site without them.

## 0.136.1

### Patch Changes

- [#716](https://github.com/valbuild/val/pull/716) [`e673b43`](https://github.com/valbuild/val/commit/e673b43feaf48b7f30881d6786c858a0cb6a44a2) Thanks [@freekh](https://github.com/freekh)! - The Studio can run a whole publish: read what to build and what to build it from, build it, and hand the result to the content service.

  The two reads go through the same proxy and the same credential as the publish conversation, and both are validated rather than cast — an error page from a gateway in between would otherwise fail several layers down inside the bundler with a message about a module specifier.

  Generating a route tree for a file-based project is a capability the deployment supplies, like `routeSplitter` and `loadCssModule` already are. Without one, such a project is refused by name rather than failing with `UNRESOLVED_ENTRY`.

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

- [#716](https://github.com/valbuild/val/pull/716) [`d2f385a`](https://github.com/valbuild/val/commit/d2f385a04978992a5036379235e447ba7775faef) Thanks [@freekh](https://github.com/freekh)! - The Studio works again when served from the published package, and a managed project's publish now puts the saved edit on the site.

  - **The Studio did not start in 0.136.0.** Its main bundle imports sibling chunks by relative path, and the Studio is served at `/api/val/static/<version>/app`, so those imports resolved to paths the handler did not know and came back as the HTML fallback — which a browser refuses as a module script. Preview was gone with it. The handler now serves those chunks, and the package build follows every import the bundle makes before it lets a release through.
  - **The in-browser builder could not load.** The Studio's bundle carried rolldown's Node WASI binding, which throws `process is not defined` in a tab. It now uses the browser binding, and the build refuses a bundle that contains the Node one.
  - **A managed publish builds what was just saved.** `/save` returns the source files the commit wrote, the Studio builds with them laid over the project's stored source, and publishes that source back with the build — so the next edit starts from this one rather than undoing it. The save's commit is also passed through to the build, which previously ran as though no commit had been made.
  - **The bundler's WebAssembly is served from `content.val.build/v1/static`** (`DEFAULT_STATIC_HOST`), still addressed by its SHA-256. `globalThis.__VAL_ROLLDOWN_WASM_URL__` still overrides it.
  - The `val.server.ts` that `@valbuild/tanstack-build` generates no longer hands a save's files to the platform (`platform.internal/__api/source`). A managed project's Studio builds in its own tab, and the platform has closed that door. `isWired` recognises files wired either way.
  - `@valbuild/tanstack-build/constants` exports the contract paths and the artifact key namespace from an entrypoint that imports nothing else, for callers that must not load the bundler. The namespace gains a `source` key.

- Updated dependencies [[`d2f385a`](https://github.com/valbuild/val/commit/d2f385a04978992a5036379235e447ba7775faef)]:
  - @valbuild/core@0.136.1

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

### Patch Changes

- Updated dependencies [[`f3a4bb7`](https://github.com/valbuild/val/commit/f3a4bb7aea604943b92545c122243798c759715c)]:
  - @valbuild/core@0.136.0

## 0.134.1

### Patch Changes

- [#709](https://github.com/valbuild/val/pull/709) [`821e789`](https://github.com/valbuild/val/commit/821e789c1af47510af5d23eb96384ff78ddd7646) Thanks [@freekh](https://github.com/freekh)! - Show the reason behind a content-service error instead of just "Internal Server
  Error".

  `content.val.build` answers a handler that threw with `{ message: "Internal
Server Error", details: "<the actual cause>" }`. Val was reading `message` and
  dropping `details`, so a failed save put exactly this in front of an editor —
  and the same text in the app's own logs, because Val was relaying it:

  ```json
  { "type": "patch-error", "message": "Internal Server Error", "errors": { … } }
  ```

  A string `details` is now appended to the message (capped at 500 characters).
  A structured one is not: that is what a _refusal_ carries, and its summary is
  already the message.

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

- Updated dependencies [[`16c49ea`](https://github.com/valbuild/val/commit/16c49ea6dd97c7a96bbfdf211af9bab5884579e2), [`eaa265e`](https://github.com/valbuild/val/commit/eaa265e78d9f6d2a1b685c38901612b8a3704eed)]:
  - @valbuild/core@0.134.0

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

## 0.130.0

### Patch Changes

- Updated dependencies [[`8425378`](https://github.com/valbuild/val/commit/8425378c315ea46b5d822f1130b633e0449ff1b0), [`473a185`](https://github.com/valbuild/val/commit/473a185f70351b44388f3bc1852649e2c1dbe001), [`64f0de3`](https://github.com/valbuild/val/commit/64f0de339b8621cb5a6c422dfe55cae5b2bbe2a0)]:
  - @valbuild/core@0.130.0

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

### Patch Changes

- Updated dependencies [[`7d34ecc`](https://github.com/valbuild/val/commit/7d34ecce787a0709025ae7b4764cb6c3ad1f766b), [`0c351c4`](https://github.com/valbuild/val/commit/0c351c4f97ae7f09772eab0e856ae69821b803b7)]:
  - @valbuild/core@0.129.0

## 0.128.0

### Patch Changes

- Updated dependencies [[`8b52b33`](https://github.com/valbuild/val/commit/8b52b33e1f629f14f66cc71dcc7cf415d210c7d4), [`362fb49`](https://github.com/valbuild/val/commit/362fb49f30d2b04c4ff78d54dca2bf5ad978a05c), [`c595799`](https://github.com/valbuild/val/commit/c59579977a436ec530c6c69f2b340ab9829d97ab)]:
  - @valbuild/core@0.128.0

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

- [#608](https://github.com/valbuild/val/pull/608) [`88262ac`](https://github.com/valbuild/val/commit/88262ac8db068650a664981ef73556457d87741a) Thanks [@freekh](https://github.com/freekh)! - Locale scopes: a subtree in one language, and one function that answers which.

  A **locale scope** is content governed by a single language. Two things open one
  today (a third, locale segments in routes, follows):

  ```typescript
  // a locale field: this object and everything below it is in one language
  s.object({ locale: s.locale(), title: s.string(), body: s.richtext() });

  // a locale-keyed record: each entry is in the language its key names
  s.record(s.locale(), s.object({ title: s.string() }));
  ```

  **A scope may not contain another scope**, and an object may have only one
  locale field. Both are reported as schema errors, naming what to move:

  ```
  An object can be in one language, so it can have one locale field.
  Found 'locale', 'language'.

  Everything here is already in one language, so 'byLanguage' cannot set
  another. Move the locale-keyed record out of this object, or take the outer
  one away.
  ```

  A scope three levels deep is reported once, by the scope immediately enclosing
  it, rather than by every ancestor.

  The rule is **validated rather than typed**. Expressing "no scope below this
  one" as a type constraint means threading it through every schema class's type
  parameter, and the errors a recursive constraint like that produces name the
  whole tree — an unrelated typo in a `.val.ts` would print pages.

  `localeAt(path, snapshot)` (from `@valbuild/shared/internal`) answers which
  language governs a path, and is the one implementation of that question, so the
  Studio, the server and the validation worker cannot disagree. It returns the
  tag, which is what `<html lang>`, `Intl` and `locales.available` all want.

  It answers `null` where no scope governs the path, where the project has
  declared no languages, and where a locale field holds something that is not one
  of them — validation is already reporting the last, and guessing would put a
  language in `<html lang>` that nobody chose.

### Patch Changes

- Updated dependencies [[`7fa8699`](https://github.com/valbuild/val/commit/7fa869974bc895af992a7d5c18b76253636d7d65), [`5b7fe05`](https://github.com/valbuild/val/commit/5b7fe05cec6365f9cd1de9ba31e65ed4a87edb63), [`88262ac`](https://github.com/valbuild/val/commit/88262ac8db068650a664981ef73556457d87741a), [`7072e07`](https://github.com/valbuild/val/commit/7072e07623c953a09ac14388ae22dada0b431ce3), [`29811c3`](https://github.com/valbuild/val/commit/29811c3f8c7e001a950e6f4833af6888e6a4efea)]:
  - @valbuild/core@0.127.0

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

- Updated dependencies [[`f2fe70d`](https://github.com/valbuild/val/commit/f2fe70dab2b65000dfaf289f09c70b4a8291467a), [`171208a`](https://github.com/valbuild/val/commit/171208a20177e68ed5a8b1a6fdaabfe893a6aa5f)]:
  - @valbuild/core@0.126.0

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

- Updated dependencies [[`c390397`](https://github.com/valbuild/val/commit/c390397cb5e203eb1bedae3a6fab15726e850b90)]:
  - @valbuild/core@0.125.0

## 0.124.0

### Minor Changes

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

### Patch Changes

- [#639](https://github.com/valbuild/val/pull/639) [`ad7fff4`](https://github.com/valbuild/val/commit/ad7fff4cc8cea98c506cf7ff9b4e8d6e5ffa4055) Thanks [@freekh](https://github.com/freekh)! - Require a session to read a file from history

  `GET /api/val/history/files` served a file at a given commit to anyone who
  asked. It followed the reasoning of `/api/val/files`, which is deliberately
  open — and neither half of that reasoning applies to it:

  - `/files` stands on `patch_id` being an unguessable UUID. A **commit sha is
    published** — `git log`, the GitHub UI, every pull request — so it is no
    substitute for a credential.
  - `/files` also _cannot_ require auth: draft images are fetched by the app's own
    backend during Next image optimisation, with no cookies to send. Nothing
    fetches history files server-side; both callers are the Studio, in a browser
    that already holds the session.

  So history files now require a session. `/files` is unchanged, and the reason
  the two differ is written down in `architecture/media.md` so it is not "fixed"
  in either direction later.

  No action needed: the Studio sends its session cookie automatically.

- Updated dependencies [[`aa89fc2`](https://github.com/valbuild/val/commit/aa89fc26de7028b3c5a1666b99afc03b39e92769)]:
  - @valbuild/core@0.124.0

## 0.123.3

### Patch Changes

- [#633](https://github.com/valbuild/val/pull/633) [`accf4f8`](https://github.com/valbuild/val/commit/accf4f852fe3400d762cc14e80316da741a69a9a) Thanks [@freekh](https://github.com/freekh)! - Stop `@valbuild/shared` replacing a consumer's own flexsearch types

  `@valbuild/shared` gained a flexsearch dependency in 0.123.0, for
  `search_content`, and typed its exported `SearchIndex.index` as flexsearch's
  own `Index`. That put `import { Index } from "flexsearch"` into the published
  `searchIndex.d.ts` — and flexsearch's type entry opens with
  `declare module "flexsearch"`, which is an AMBIENT module declaration and so
  global to a whole TypeScript program.

  The effect on a project that uses flexsearch itself, at a different version:
  its own calls are checked against the copy Val dragged in. valbuild/web pins
  flexsearch 0.7 and builds an index with
  `new flexsearch.Document({ language: "en", … })`; on `@valbuild/shared@0.123.2`
  that stopped compiling, because 0.8's `DocumentOptions` has no `language`. Its
  resolved copy was still 0.7 — only the types had been swapped underneath it.

  `SearchIndex.index` is now a structural type covering the three methods this
  package calls, so nothing in the published declarations names flexsearch. The
  library is still used to build the index; that is a value import, which never
  reaches a `.d.ts`.

  No API change: `SearchIndex` is still assignable from a real flexsearch
  `Index`, and `noFlexsearchInPublishedTypes.test.ts` asserts both halves of that
  — that no source file names flexsearch in a type position, and that a real
  `Index` still satisfies the stand-in, so it cannot drift from the library
  unnoticed.

- [#628](https://github.com/valbuild/val/pull/628) [`aef45ce`](https://github.com/valbuild/val/commit/aef45ce3ef269f1b6221de44a56df0f6a0d9dbbd) Thanks [@freekh](https://github.com/freekh)! - Stop the serialized-schema parser dropping schema metadata

  `SerializedSchema` in `@valbuild/shared` is a zod mirror of the serialized
  schema type, and its `z.object`s strip keys they do not declare. Five fields
  were declared on some schemas and forgotten on others:

  - `customValidate` — missing on twelve of the eighteen schemas. This is the flag
    that says a schema declares a `.validate()`; the function itself cannot
    serialize, so the flag is the only thing that tells the Studio to run the
    custom validators against the real instance.
  - `description` — missing on thirteen, so a `.describe()` went unseen.
  - `remote` and `referencedModule` — missing on `s.image()` and `s.file()`, so a
    remote field read as local and a gallery-backed field lost the gallery it
    reads its dimensions and mime type from.
  - the `message` on a `.regexp(pattern, message)` — so a field with a custom
    pattern message fell back to the generic "Expected string to match reg
    exp: …".

  Because it strips rather than rejects, nothing failed and nothing said so. The
  live `/schema` route was unaffected — `ValClient` validates the response and
  then returns the raw JSON — but the history path consumes the parsed output, so
  in a commit or historical patch-set view (`getModuleAtCommit`,
  `getHistoricalPatchSet`) a schema's custom validators, description, remoteness
  and backing gallery all quietly disappeared.

  The fields every serialized schema shares are now spread from one
  `commonSchemaFields` object instead of being retyped eighteen times, which is
  how they drifted apart in the first place. A round-trip test walks each schema's
  serialized output against the parsed result and fails with the path of any key
  that did not survive, so a field added to a serialized schema and forgotten in
  the parser is caught without anyone having to remember to assert it.

## 0.123.2

### Patch Changes

- [#629](https://github.com/valbuild/val/pull/629) [`04b6d4c`](https://github.com/valbuild/val/commit/04b6d4cbbecc131bbaf3c20633af9dad8c857310) Thanks [@freekh](https://github.com/freekh)! - Stop shipping zod to every visitor of a Val site (~113 KB)

  `@valbuild/next`'s client code needed five things from
  `@valbuild/shared/internal`, three of which are string constants like
  `VAL_THEME_SESSION_STORAGE_KEY`. But preconstruct publishes each entrypoint as
  a single bundled module, so importing a string constant pulled in the whole
  entrypoint — including `ApiRoutes.ts` and its zod schemas. Measured on
  val.build, that was 113 KB of zod in the initial JS of every page, for
  visitors who never open the Studio.

  Two changes:

  - New `@valbuild/shared/client` entrypoint carrying the parts that are safe in
    a browser bundle: the session-storage keys, the canvas protocol, and the
    route-pattern helpers. Nothing reachable from it may import zod, and
    `noZodInClientEntrypoint.test.ts` walks the source graph to enforce that —
    one careless re-export would silently put the 113 KB back.
  - `ValNextProvider` now imports `createValClient` on first use rather than at
    module scope. It genuinely needs zod (it `safeParse`s every request and
    response), but its only caller is the draft-mode poll, which returns early
    unless the overlay is mounted. A visitor without the Val Enable cookie never
    triggers the import.

  No API change. `@valbuild/shared/internal` still exports everything it did.

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

- [#618](https://github.com/valbuild/val/pull/618) [`da6794f`](https://github.com/valbuild/val/commit/da6794f3dbd77d49ccfe780b359bab1689ee1b11) Thanks [@freekh](https://github.com/freekh)! - Remove the unused `GET /api/val/session` endpoint.

  Nothing called it. The Studio reads the profile id from `/stat`, and in proxy
  mode the route proxied to `${VAL_BUILD_URL}/api/val/${project}/auth/session`,
  an upstream route that no longer exists — so calling it by hand returned a 500
  rather than a session. It is gone from both the route declarations in
  `@valbuild/shared` and the implementation in `@valbuild/server`.

  Session cookie handling itself is unchanged: `/authorize`, `/callback` and
  `/logout` still set and clear `val_session` as before.

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

- Updated dependencies [[`2bcbee1`](https://github.com/valbuild/val/commit/2bcbee1be682c2bbd5b7bc7d152ddd4204162fd2), [`6794d29`](https://github.com/valbuild/val/commit/6794d2980bc81284ab7f2cc667f01cc21c9e3a79)]:
  - @valbuild/core@0.121.0

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

### Patch Changes

- Updated dependencies [[`c2d3c0e`](https://github.com/valbuild/val/commit/c2d3c0e6c2010c0a94c725d9dbaa618998773e8a)]:
  - @valbuild/core@0.120.0

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

- Updated dependencies [[`d94a40f`](https://github.com/valbuild/val/commit/d94a40f8bd11027636d183e293aced820b6f341f), [`b2812ae`](https://github.com/valbuild/val/commit/b2812ae4ee03e005ecead3365f49c625e536f94d)]:
  - @valbuild/core@0.117.0
