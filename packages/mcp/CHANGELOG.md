# @valbuild/mcp

## 0.136.2

### Patch Changes

- Updated dependencies [[`f76cd56`](https://github.com/valbuild/val/commit/f76cd56b9f1c1bcc0a608a7a4de24b1e776adccb)]:
  - @valbuild/server@0.136.2
  - @valbuild/shared@0.136.2

## 0.136.1

### Patch Changes

- Updated dependencies [[`e673b43`](https://github.com/valbuild/val/commit/e673b43feaf48b7f30881d6786c858a0cb6a44a2), [`5c82928`](https://github.com/valbuild/val/commit/5c82928992d29f133f81cf0704a273c0449b18f1), [`4450be5`](https://github.com/valbuild/val/commit/4450be570ec3a66d7d98ba273c333ca2d2f163d9), [`d2f385a`](https://github.com/valbuild/val/commit/d2f385a04978992a5036379235e447ba7775faef)]:
  - @valbuild/shared@0.136.1
  - @valbuild/server@0.136.1
  - @valbuild/core@0.136.1

## 0.136.0

### Patch Changes

- Updated dependencies [[`f3a4bb7`](https://github.com/valbuild/val/commit/f3a4bb7aea604943b92545c122243798c759715c), [`1d72d00`](https://github.com/valbuild/val/commit/1d72d00a1b036959ae0f1540121701cbb2694dcb)]:
  - @valbuild/core@0.136.0
  - @valbuild/server@0.136.0
  - @valbuild/shared@0.136.0

## 0.135.0

### Patch Changes

- Updated dependencies [[`c9affec`](https://github.com/valbuild/val/commit/c9affece6ae6ba62bd6c1113ed1fdab6317fa112), [`72a7ca7`](https://github.com/valbuild/val/commit/72a7ca78354fff00e37a51359b17fba9334dc5e6)]:
  - @valbuild/server@0.135.0

## 0.134.1

### Patch Changes

- Updated dependencies [[`821e789`](https://github.com/valbuild/val/commit/821e789c1af47510af5d23eb96384ff78ddd7646)]:
  - @valbuild/shared@0.134.1
  - @valbuild/server@0.134.1

## 0.134.0

### Patch Changes

- Updated dependencies [[`be78a9b`](https://github.com/valbuild/val/commit/be78a9b51678439f7ecb1c7f3887f9e8e1261a13), [`16c49ea`](https://github.com/valbuild/val/commit/16c49ea6dd97c7a96bbfdf211af9bab5884579e2), [`eaa265e`](https://github.com/valbuild/val/commit/eaa265e78d9f6d2a1b685c38901612b8a3704eed)]:
  - @valbuild/server@0.134.0
  - @valbuild/core@0.134.0
  - @valbuild/shared@0.134.0

## 0.133.0

### Patch Changes

- Updated dependencies [[`802412b`](https://github.com/valbuild/val/commit/802412b92c06bc1abbca78c86885e39c8710dd83)]:
  - @valbuild/server@0.133.0
  - @valbuild/shared@0.133.0

## 0.132.1

### Patch Changes

- Updated dependencies [[`c07b1ab`](https://github.com/valbuild/val/commit/c07b1abe30e226c80ef7ec4b4f0f5ccdae061c11), [`cbfa2b8`](https://github.com/valbuild/val/commit/cbfa2b884898f1603bde8e5aa5cd9da78778101f)]:
  - @valbuild/server@0.132.1

## 0.132.0

### Patch Changes

- Updated dependencies [[`72cc676`](https://github.com/valbuild/val/commit/72cc6765e92a6e72b5c09ddd9eed8efa7ce899f2)]:
  - @valbuild/server@0.132.0

## 0.131.0

### Patch Changes

- Updated dependencies [[`0d5857b`](https://github.com/valbuild/val/commit/0d5857b731e11f7e6a011f79297df6485908c31f)]:
  - @valbuild/server@0.131.0

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

- Updated dependencies [[`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75), [`8425378`](https://github.com/valbuild/val/commit/8425378c315ea46b5d822f1130b633e0449ff1b0), [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75), [`473a185`](https://github.com/valbuild/val/commit/473a185f70351b44388f3bc1852649e2c1dbe001), [`64f0de3`](https://github.com/valbuild/val/commit/64f0de339b8621cb5a6c422dfe55cae5b2bbe2a0), [`cab4098`](https://github.com/valbuild/val/commit/cab4098969585977b8d7574e86d66fcb01cb1d75)]:
  - @valbuild/server@0.130.0
  - @valbuild/core@0.130.0
  - @valbuild/shared@0.130.0

## 0.129.0

### Patch Changes

- Updated dependencies [[`7d34ecc`](https://github.com/valbuild/val/commit/7d34ecce787a0709025ae7b4764cb6c3ad1f766b), [`0c351c4`](https://github.com/valbuild/val/commit/0c351c4f97ae7f09772eab0e856ae69821b803b7)]:
  - @valbuild/core@0.129.0
  - @valbuild/shared@0.129.0
  - @valbuild/server@0.129.0

## 0.128.0

### Patch Changes

- Updated dependencies [[`8b52b33`](https://github.com/valbuild/val/commit/8b52b33e1f629f14f66cc71dcc7cf415d210c7d4), [`362fb49`](https://github.com/valbuild/val/commit/362fb49f30d2b04c4ff78d54dca2bf5ad978a05c), [`c595799`](https://github.com/valbuild/val/commit/c59579977a436ec530c6c69f2b340ab9829d97ab)]:
  - @valbuild/core@0.128.0
  - @valbuild/server@0.128.0
  - @valbuild/shared@0.128.0

## 0.127.0

### Patch Changes

- Updated dependencies [[`7fa8699`](https://github.com/valbuild/val/commit/7fa869974bc895af992a7d5c18b76253636d7d65), [`5b7fe05`](https://github.com/valbuild/val/commit/5b7fe05cec6365f9cd1de9ba31e65ed4a87edb63), [`88262ac`](https://github.com/valbuild/val/commit/88262ac8db068650a664981ef73556457d87741a), [`7072e07`](https://github.com/valbuild/val/commit/7072e07623c953a09ac14388ae22dada0b431ce3), [`29811c3`](https://github.com/valbuild/val/commit/29811c3f8c7e001a950e6f4833af6888e6a4efea)]:
  - @valbuild/core@0.127.0
  - @valbuild/shared@0.127.0
  - @valbuild/server@0.127.0

## 0.126.0

### Patch Changes

- Updated dependencies [[`5bfd630`](https://github.com/valbuild/val/commit/5bfd630b63dee2189e238f20fe72ecc5537160f7), [`ccbcda6`](https://github.com/valbuild/val/commit/ccbcda60b3e3c465071229ae1ba28ac735483e63), [`f2fe70d`](https://github.com/valbuild/val/commit/f2fe70dab2b65000dfaf289f09c70b4a8291467a), [`5c18c99`](https://github.com/valbuild/val/commit/5c18c99ecc84651f82123481fc042063db953833), [`171208a`](https://github.com/valbuild/val/commit/171208a20177e68ed5a8b1a6fdaabfe893a6aa5f)]:
  - @valbuild/shared@0.126.0
  - @valbuild/server@0.126.0
  - @valbuild/core@0.126.0

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
