# @valbuild/mcp

## 0.125.0

### Patch Changes

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

- Updated dependencies [[`4c9369b`](https://github.com/valbuild/val/commit/4c9369bad3f17e96868262e78a4f47361d85319e), [`fb1baff`](https://github.com/valbuild/val/commit/fb1baffead5228d8a86a51af65178b88738d5a64), [`accf4f8`](https://github.com/valbuild/val/commit/accf4f852fe3400d762cc14e80316da741a69a9a), [`aef45ce`](https://github.com/valbuild/val/commit/aef45ce3ef269f1b6221de44a56df0f6a0d9dbbd)]:
  - @valbuild/server@0.123.3
  - @valbuild/shared@0.123.3

## 0.123.2

### Patch Changes

- Updated dependencies [[`04b6d4c`](https://github.com/valbuild/val/commit/04b6d4cbbecc131bbaf3c20633af9dad8c857310), [`8e58c34`](https://github.com/valbuild/val/commit/8e58c3495d1bf0f221a57082cb0a3045929722a1)]:
  - @valbuild/shared@0.123.2
  - @valbuild/server@0.123.2

## 0.123.1

### Patch Changes

- [#625](https://github.com/valbuild/val/pull/625) [`468f147`](https://github.com/valbuild/val/commit/468f147e62d1a96585890208921341959f118b6d) Thanks [@freekh](https://github.com/freekh)! - Republish `@valbuild/mcp` with resolvable dependency versions.

  `@valbuild/mcp@0.123.0` shipped its manifest with the workspace protocol intact —
  `"@valbuild/core": "workspace:*"` and the same for `server` and `shared` — so it
  cannot be installed. npm refuses it with
  `EUNSUPPORTEDPROTOCOL: Unsupported URL Type "workspace:"`, and pnpm with
  `ERR_PNPM_WORKSPACE_PKG_NOT_FOUND`. `@valbuild/next@0.123.0` depends on that exact
  version, so it could not be installed either.

  Both of those versions are deprecated. Use this one.

  Nothing in the source was wrong: every package in the repository declares its
  siblings as `workspace:*` and the publish step rewrites them to real versions.
  That version was published by hand with `npm publish`, which uploads the manifest
  verbatim — the rewrite is pnpm's, and only `pnpm publish` (which is what
  `changeset publish` runs here) performs it.

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

### Patch Changes

- Updated dependencies [[`c5e7dfd`](https://github.com/valbuild/val/commit/c5e7dfd12aa1371195be642e1c2fb72b6f3e3ce2), [`53f670c`](https://github.com/valbuild/val/commit/53f670c0cf2d7a03a6d068c78b7874ce77652c2a)]:
  - @valbuild/server@0.123.0
  - @valbuild/shared@0.123.0
