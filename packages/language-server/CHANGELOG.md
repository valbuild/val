# @valbuild/language-server

## 0.126.0

### Patch Changes

- Updated dependencies [[`5bfd630`](https://github.com/valbuild/val/commit/5bfd630b63dee2189e238f20fe72ecc5537160f7), [`ccbcda6`](https://github.com/valbuild/val/commit/ccbcda60b3e3c465071229ae1ba28ac735483e63), [`f2fe70d`](https://github.com/valbuild/val/commit/f2fe70dab2b65000dfaf289f09c70b4a8291467a), [`5c18c99`](https://github.com/valbuild/val/commit/5c18c99ecc84651f82123481fc042063db953833), [`171208a`](https://github.com/valbuild/val/commit/171208a20177e68ed5a8b1a6fdaabfe893a6aa5f)]:
  - @valbuild/shared@0.126.0
  - @valbuild/server@0.126.0
  - @valbuild/core@0.126.0

## 0.125.0

### Patch Changes

- [#645](https://github.com/valbuild/val/pull/645) [`22f78b4`](https://github.com/valbuild/val/commit/22f78b471fd18e542f518f72b75bd472d7c3dc52) Thanks [@freekh](https://github.com/freekh)! - The editor no longer warns "Remote image was not checked." on every remote image
  and file.

  That message is a placeholder: core cannot reach the content host, so
  `s.image().remote()` reports it unconditionally and leaves the real check to
  whoever can make it. `val validate` makes it and prints nothing when the ref is
  sound; the language server was publishing the placeholder raw, so every remote
  image in a project carried a permanent warning that no quick fix could clear.

  It is now adjudicated the same way the metadata placeholder already was — by
  running Val's own check — so a valid ref reports nothing, and a ref that no
  longer matches the bytes behind it reports what the CLI reports:

  ```
  Remote ref: https://remote.val.build/file/p/…/renaming.gif is not valid. Use the --fix flag to fix this issue.
  ```

  Nothing is downloaded for a ref that still adds up; only a stale one is fetched,
  into the same `.val/remote-file-cache` the CLI uses.

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

- Updated dependencies [[`c390397`](https://github.com/valbuild/val/commit/c390397cb5e203eb1bedae3a6fab15726e850b90)]:
  - @valbuild/core@0.125.0
  - @valbuild/shared@0.125.0
  - @valbuild/server@0.125.0

## 0.124.0

### Patch Changes

- Updated dependencies [[`ad7fff4`](https://github.com/valbuild/val/commit/ad7fff4cc8cea98c506cf7ff9b4e8d6e5ffa4055), [`ad7fff4`](https://github.com/valbuild/val/commit/ad7fff4cc8cea98c506cf7ff9b4e8d6e5ffa4055), [`aa89fc2`](https://github.com/valbuild/val/commit/aa89fc26de7028b3c5a1666b99afc03b39e92769)]:
  - @valbuild/server@0.124.0
  - @valbuild/shared@0.124.0
  - @valbuild/core@0.124.0

## 0.123.3

### Patch Changes

- [#623](https://github.com/valbuild/val/pull/623) [`4c9369b`](https://github.com/valbuild/val/commit/4c9369bad3f17e96868262e78a4f47361d85319e) Thanks [@freekh](https://github.com/freekh)! - Add the editor quick fix for a `.jsonValues()` entry written inline: **Val: move entry into its own .val.json**.

  The language server already reported the problem — "Entry '…' is written inline … Run 'val validate --fix' to move it" — but offered no way to act on it, so the only remedy was to leave the editor and run the CLI. It now offers a quick fix that creates the `*.val.json` with the entry's content and rewrites the `.val.ts` to `c.json(() => import("./…"))`, in one undoable step.

  The fix is computed from the same code `val validate --fix` runs, so the two write the same files, and it is computed against the buffer you are looking at rather than what is on disk — an unsaved module can be fixed without saving first. It refuses, rather than overwriting, when a file or an unsaved buffer already occupies the target path.

  Requires an editor that honours file creation inside a workspace edit; VS Code does. In an editor that does not announce it, no action is offered rather than one that would rewrite the module to import a file that never got created.

- Updated dependencies [[`4c9369b`](https://github.com/valbuild/val/commit/4c9369bad3f17e96868262e78a4f47361d85319e), [`fb1baff`](https://github.com/valbuild/val/commit/fb1baffead5228d8a86a51af65178b88738d5a64), [`accf4f8`](https://github.com/valbuild/val/commit/accf4f852fe3400d762cc14e80316da741a69a9a), [`aef45ce`](https://github.com/valbuild/val/commit/aef45ce3ef269f1b6221de44a56df0f6a0d9dbbd)]:
  - @valbuild/server@0.123.3
  - @valbuild/shared@0.123.3

## 0.123.2

### Patch Changes

- Updated dependencies [[`04b6d4c`](https://github.com/valbuild/val/commit/04b6d4cbbecc131bbaf3c20633af9dad8c857310), [`8e58c34`](https://github.com/valbuild/val/commit/8e58c3495d1bf0f221a57082cb0a3045929722a1)]:
  - @valbuild/shared@0.123.2
  - @valbuild/server@0.123.2

## 0.123.0

### Patch Changes

- Updated dependencies [[`c5e7dfd`](https://github.com/valbuild/val/commit/c5e7dfd12aa1371195be642e1c2fb72b6f3e3ce2), [`53f670c`](https://github.com/valbuild/val/commit/53f670c0cf2d7a03a6d068c78b7874ce77652c2a)]:
  - @valbuild/server@0.123.0
  - @valbuild/shared@0.123.0

## 0.122.0

### Patch Changes

- Updated dependencies [[`be32261`](https://github.com/valbuild/val/commit/be32261af19db8018bc37b180d903416018c0b79), [`5d14612`](https://github.com/valbuild/val/commit/5d14612f612d657a37338136188f2b3c02b28fe7), [`da6794f`](https://github.com/valbuild/val/commit/da6794f3dbd77d49ccfe780b359bab1689ee1b11)]:
  - @valbuild/server@0.122.0
  - @valbuild/shared@0.122.0

## 0.121.0

### Patch Changes

- Updated dependencies [[`2bcc6fd`](https://github.com/valbuild/val/commit/2bcc6fdff8d668123e07e3c5e81ac6fa1436e47b), [`2bcbee1`](https://github.com/valbuild/val/commit/2bcbee1be682c2bbd5b7bc7d152ddd4204162fd2), [`6794d29`](https://github.com/valbuild/val/commit/6794d2980bc81284ab7f2cc667f01cc21c9e3a79)]:
  - @valbuild/shared@0.121.0
  - @valbuild/server@0.121.0
  - @valbuild/core@0.121.0

## 0.120.4

### Patch Changes

- Updated dependencies []:
  - @valbuild/server@0.120.4

## 0.120.3

### Patch Changes

- Updated dependencies []:
  - @valbuild/server@0.120.3

## 0.120.2

### Patch Changes

- [#593](https://github.com/valbuild/val/pull/593) [`095ee0d`](https://github.com/valbuild/val/commit/095ee0dd011b069c30bc99ae58356e28796e106b) Thanks [@freekh](https://github.com/freekh)! - Publish the packages that 0.120.1 did not reach.

  `@valbuild/server@0.120.1` made it to npm, but `@valbuild/cli`,
  `@valbuild/language-server` and `@valbuild/next` did not — the release job
  failed part-way through, and the version numbers it had already claimed could
  not be reused. This release carries the same contents for those three packages:
  they pick up the MCP signing-key rotation fix from `@valbuild/server@0.120.1`,
  and there is nothing else in it.

  If you are on 0.120.0, upgrade straight to this version. There is no 0.120.1 of
  these three packages, and there will not be one.

## 0.120.1

### Patch Changes

- Updated dependencies [[`6f318d4`](https://github.com/valbuild/val/commit/6f318d406295b772e721bf463283f47e2822e996)]:
  - @valbuild/server@0.120.1

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
  - @valbuild/shared@0.120.0
  - @valbuild/server@0.120.0

## 0.119.0

### Patch Changes

- Updated dependencies []:
  - @valbuild/server@0.119.0

## 0.118.0

### Patch Changes

- Updated dependencies [[`198ba8b`](https://github.com/valbuild/val/commit/198ba8bd8e6c921660e97f5cd26fb17f2d5f3f95)]:
  - @valbuild/server@0.118.0
  - @valbuild/shared@0.118.0

## 0.117.1

### Patch Changes

- Updated dependencies []:
  - @valbuild/server@0.117.1

## 0.117.0

### Patch Changes

- [#581](https://github.com/valbuild/val/pull/581) [`d94a40f`](https://github.com/valbuild/val/commit/d94a40f8bd11027636d183e293aced820b6f341f) Thanks [@freekh](https://github.com/freekh)! - Images no longer show a validation warning in the editor when nothing is wrong
  with them.

  Every `s.image()` carrying width, height or a mime type used to be marked in VS
  Code with "Found image metadata, but it could not be validated", whether or not
  the metadata was correct — so the warning sat on every image in the project and
  never went away, not even after applying its own quick fix.

  That message was never a finding. `@valbuild/core` cannot read files, so it
  cannot answer whether stored dimensions match the image, and it hands the
  question on as an `image:check-metadata` fix instead. `val validate` has always
  resolved that by reading the file and comparing; the language server now does
  the same, and reports only what actually disagrees:

  ```
  Image width is incorrect! Found: 800. Expected: 944
  ```

  An image whose metadata is right gets nothing. A missing `width`, `height` or
  `mimeType` is reported, as is a stale one, with the quick fix still offered. A
  file that is not on disk is still reported as a missing file rather than as a
  metadata problem.

  The four messages involved say what they mean now, in the editor and in
  `val validate` alike:

  - "Image metadata has not been checked against the file." (was "Found image
    metadata, but it could not be validated. An image must have a width (positive
    number), a height (positive number) and a mime type." — which described a
    check that never ran)
  - "Image metadata is missing: width, height and mimeType." (was "Could not
    validate Image metadata.")
  - "File mimeType has not been checked against the file." (was "Found mimeType,
    but it could not be validated.")
  - "File metadata is missing: mimeType." (was "Missing File mimeType.")

  Also fixes an `s.file()` whose `mimeType` is missing: it reported "Mime type and
  file extension not matching. Mime type is 'undefined'" with no fix attached, so
  no quick fix was offered and the `file:add-metadata` case was unreachable. It
  now reports the missing mime type and offers to add it.

- [#579](https://github.com/valbuild/val/pull/579) [`b2812ae`](https://github.com/valbuild/val/commit/b2812ae4ee03e005ecead3365f49c625e536f94d) Thanks [@freekh](https://github.com/freekh)! - Every release now ships a changelog. Each package's `CHANGELOG.md` records what
  changed under the version that shipped it — with a link to the pull request, the
  commit and the author — and the same entry becomes the body of the GitHub
  Release for the tag. The file is included in the npm tarball, so it is also
  readable from an installed copy.

  Up to now those changelogs were generated empty, and the GitHub Releases with
  them, so there was no record of what any given version contained. Releases from
  this one on have one; earlier versions stay blank.

- Updated dependencies [[`fca3efa`](https://github.com/valbuild/val/commit/fca3efa389e2817401f55ea3dd184af7c611b807), [`d94a40f`](https://github.com/valbuild/val/commit/d94a40f8bd11027636d183e293aced820b6f341f), [`b2812ae`](https://github.com/valbuild/val/commit/b2812ae4ee03e005ecead3365f49c625e536f94d)]:
  - @valbuild/server@0.117.0
  - @valbuild/core@0.117.0
  - @valbuild/shared@0.117.0
