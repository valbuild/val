# Demo mode: try the Studio with no account and no backend

> **Status: decided, not started.** The backend is option B, the real server
> in the tab (section 3); demo mode is switched on by an env var in the
> template (section 6); one demo per tab. Section 8 is the build order. Section
> 7 (the demo template and the Studio tour) is still to be discussed.

The goal: someone opens a link to a demo site's `/val`, gets the real Studio
with the page in the canvas beside it, edits content and sees the preview
change — **without signing in and without any request for content or patches
leaving the tab**. Their edits live in the browser session and are gone when
they reset.

## 1. Scope

Decided:

- **TanStack Start only.** No Next.js demo.
- **Inside the Studio only.** The canvas preview (`CanvasFrame`, an iframe of
  the site with `?val_canvas=1`) is the one place edits show up. No overlay on
  the site's own pages.
- **No publish.** The Publish button is not offered. Edits stay pending for the
  life of the demo.
- **Files and images are read-only** if supporting them costs a lot — and it
  does (section 5). Existing media is shown and can be picked from a gallery;
  nothing can be uploaded.

That scope removes the hard parts of the general problem: no `/save` (so no
TypeScript rewrite of `.val.ts` text in the browser), no second document
competing for the patch chain, no draft-mode cookies on the site's own pages,
and no unpublished binaries to serve.

## 2. What the Studio needs from a backend, inside that scope

The Studio already does most of its work in the tab. It reads schemas and
sources from the app's modules (`window.__VAL_MODULES__`, evaluated in
`ValStoreProvider`), applies the patch chain itself (`SourceStore`), and
validates in a worker (`ValidationStore`). The canvas page receives source over
`postMessage` from `CanvasFrame` and `ValCanvasBridge` turns it into
`"val-event"`s for the client store that `useVal` reads.

What is left for a server, counted from the `client(...)` calls in
`packages/ui/spa`:

| Route                                                                                                  | Who calls it                                                     | In the demo (memory mode, in the tab)                                           |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `POST /stat` (×3)                                                                                      | `useStatus`, `createValSystem` (chain, schema freshness)         | memory mode's own answer: fs-shaped, long-polled on an in-process signal        |
| `PUT /patches`                                                                                         | `createValSystem` save seam                                      | the real head check: 409 on a stale `parentRef`                                 |
| `GET /patches` (×2)                                                                                    | `createValSystem`, `DraftChanges`                                | the stored records                                                              |
| `DELETE /patches`                                                                                      | discard                                                          | drop them                                                                       |
| `GET /profiles`                                                                                        | `ValProvider`                                                    | what memory mode answers without auth; the demo shows no authors                |
| `GET /json`                                                                                            | `.jsonValues()` entries                                          | memory mode serves entries from the modules, as it does for app mode            |
| `PUT /sources/~`                                                                                       | `BaseAlignment`, only when `/stat`'s `sourcesSha` ≠ the bundle's | not reached: the server reads the same modules as the bundle, so the shas match |
| `POST /direct-file-upload-settings`                                                                    | uploads                                                          | not reached: uploads are off                                                    |
| `/save`, `/history/*`, `/ai/*`, `/admin/status`, `/remote/settings`, `/external-urls/check`, proposals | publish, History, assistant, Val Build access, link checks       | hidden in the demo; memory mode refuses what it does not support                |

Two hashes have to be right or the Studio will try to fetch things that do not
exist: `/stat`'s `sourcesSha` must equal what `HostStore` folds from the
bundle, and its `schemaSha` must equal the bundle's (see
`SchemaFreshnessWatch`). With the real server in the tab both are computed by
the server's own code from the very modules the Studio loaded, so they agree by
construction -- one of the reasons for option B.

That is **seven routes, all of them going through `ValClient`**. Nothing here
needs a Service Worker: the side channels that bypass `ValClient` (the upload
`XMLHttpRequest`, `/api/val/files?patch_id=…` image URLs, the `/enable`
navigation) are all out of scope.

## 3. Options for the in-tab backend

**Decided: option B.** A and C are kept below as the record of why.

### Option A — A demo `ValClient`

`createDemoClient(valModules)` implements `ClientOf<Api>` for the seven routes
above, holding the chain in memory and mirroring it to `sessionStorage` (it is
text, so a few KB; it survives a reload and dies with the tab). `App.tsx` uses
it instead of `createValClient("/api/val")` when the config says demo. Nothing
else in the Studio changes how it talks to the server.

The worry with a hand-written fake is that it drifts from the real server — the
repo's stance (see "Proxy mode" in `.claude/CLAUDE.md`) is that a second fake
in shipped code goes wrong with nothing testing it. The answer is a **contract
test**: run the same request sequence against `ValServer` in memory mode
(`ValOpsMemory`, already exported and tested) in jest and against the demo
client, and assert they answer alike — chain order, head check, 409s, `/stat`
shape. The fake stays small because the scope does, and the test is what keeps
it honest.

- **Size:** S. Roughly 300 lines plus the contract test.

### Option B — The real server and router in the tab, with only the network removed

`createValApiRouter` (`packages/server/src/ValRouter.ts`) is already a
web-standard function, `(req: Request) => Promise<Response>`, and
`createValClient` (`packages/shared/src/internal/ValClient.ts`) does nothing
but build a URL and call `fetch`. So the demo can run the whole production
pipeline in the tab and cut out exactly one thing, the network hop:

```
today:  createValClient ── fetch ──► network ──► createValApiRouter ─► ValServer ─► ValOpsMemory/FS/Http
demo:   createValClient ── fetch ─────────────► createValApiRouter ─► ValServer ─► ValOpsMemory
                         (injected: router(new Request(url, init)))
```

- `createValClient` gains an optional `fetch`. The demo passes one that hands
  the `Request` to an in-tab router instead of the network.
- The router runs a `ValServer` in memory mode (`ValOpsMemory`) with
  `sourceFiles: {}`, `unsafelyAllowUnauthenticated: true`, and the modules the
  Studio already has (`window.__VAL_MODULES__`). `sourceFiles` is only read by
  `prepare` (`ValOps.ts`, the `/save` path), so with no publish it can be
  empty. Edits are kept in a `ValPatchStore` backed by `sessionStorage`.
- Memory mode is not a fake. It is the backend of the hosted Val app, it has
  its own tests (`ValOpsMemory.*.test.ts`), and it reports `mode: "fs"`, so
  the Studio behaves as it does in local development: auto-save, long-polled
  `/stat`, no deployments. The content and schema hashes on `/stat` come from
  the same server code reading the same modules, so they match the bundle's
  by construction.

**What it takes**, measured by bundling `ValServer` for the browser with
esbuild (2026-10-18). Fifteen Node-only imports fail to resolve, from about
twenty files, almost all of them belonging to modes the demo never runs.

The fix is the split `@valbuild/tanstack-build` already has: a root that a
browser can import, and a Node half that hands the Node-only pieces to it.
**Lazy `import()` is not enough** -- a bundler follows a dynamic import of a
literal path just as it follows a static one, and fails on what it finds there.
So the browser-safe core takes these as parameters instead of importing them:

| Import                             | From                                                                             | Fix                                                                     |
| ---------------------------------- | -------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `fs`, `os`, `crypto`               | `ValOpsFS`, `patchStore`, `patchLog`, `patchLock`, `jsonEntryFiles`              | the core takes a constructed `ValOps`; the Node entry builds FS or HTTP |
| `crypto`, `path`                   | `ValOpsHttp`, `proposalMerge/*`                                                  | same                                                                    |
| `node:http`, `https`, `net`, `dns` | `linkCheck/probeUrl.ts`                                                          | injected by the Node entry; absent in the demo (the route says so)      |
| `node:vm`, `node:module`, `fs`     | `loadValModules`, `createNodeRequire`, `valServerConfig`, `personalAccessTokens` | Node entry only (config resolution is a Node concern)                   |
| `crypto`, `buffer`                 | `jwt.ts`                                                                         | Web Crypto (available in Node too), or injected                         |
| `path`                             | `ValServer`, `rewriteDraftPlaylist`, `patch/jsonValuesPatch`, `history/*`        | a posix `path` shim (these only join and split)                         |
| `typescript`                       | `ValOps.ts` (`prepare`, i.e. publish)                                            | injected into `prepare`; the demo has no publish                        |
| `@valbuild/ui/server`              | `ValRouter.ts` (the Studio's own embedded assets)                                | inject the static handler; the demo has none                            |

With node builtins stubbed, the bundle is 4.3 MB minified, and 3.5 MB of that
is `typescript`. Without it, the server's own code is about 190 KB minified;
`zod`, core and shared are already in the Studio's bundle. All of it is a lazy
chunk that only a demo loads.

Three tests keep it that way, each catching what the one before cannot:

1. **The import guard** (jest, milliseconds). Walks the import graph from the
   demo's entry -- static and literal dynamic imports, as
   `packages/tanstack-build/src/noNodeFromBrowser.test.ts` does -- and fails if
   a Node builtin is reachable, naming the chain of files that reaches it.
2. **The in-tab round trip** (jest). `createValClient` with the in-tab `fetch`,
   the real router, a memory-mode `ValServer`: read `/stat`, save a patch, read
   it back, save on a stale parent and get the 409. Catches a change that
   leaves the demo bundleable but no longer working.
3. **The demo e2e** (Playwright, in the blocking `smoke` job). Build
   `examples/tanstack` with the demo flag, open `/val`, edit a field, and see
   the canvas change -- with every request to `/api/val/*` other than the
   Studio's static assets failed by `page.route`. Catches what neither jest
   test can: a new Studio feature that calls the server some other way than
   through the client, or that memory mode does not support.
   Run it in the `webkit-http` project too: every browser on iOS is WebKit,
   and that is the engine a demo link opened on a phone runs in.

- **For:** the most faithful option by a distance. The Studio's client, the
  router's request parsing, every route handler, the patch chain, the head
  check and the hashes are all production code; a new route or a change to the
  patch protocol reaches the demo with nobody touching the demo. No fake to
  keep in step with anything, and no change to `ValProvider` or the stores.
- **Against:** a refactor of `packages/server`'s imports (the table above),
  and one more CI guard. The demo also inherits any gap memory mode has — but
  memory mode is a shipped backend, so a gap there is a bug for app mode too.
- **Later:** the same router can move into a Service Worker unchanged if we
  ever want uploads (it would answer `/api/val/files` and the upload URL) or
  publish.
- **Size:** M. Most of it is splitting `packages/server` into a browser-safe core and a Node entry, which also makes memory mode
  lighter for the Worker host it was written for.

### Option C — Swap the stores' seams instead of the client

The store layer was built so that only one file knows about HTTP.
`createSystem` (`stores/createSystem.ts`) takes every network path as a plain
async function — a **seam** — and `createValSystem`
(`stores/react/createValSystem.ts`) is the one place that turns each seam into
a `ValClient` call:

```
                         today                                   option C
  ValProvider ── createValSystem(client) ── createSystem   ValProvider ── createDemoSystem(memory) ── createSystem
                    │ fetchPatches   → GET /patches                          │ fetchPatches   → memory
                    │ savePatches    → PUT /patches                          │ savePatches    → memory (head check, 409)
                    │ discardPatches → DELETE /patches                       │ discardPatches → memory
                    │ fetchJsonEntry → GET /json                             │ fetchJsonEntry → the module's own thunk
                    │ uploadFile     → XHR                                   │ uploadFile     → (absent: read-only)
                    │ publishPatches → POST /save                            │ publishPatches → (absent: no publish)
                    │ resyncChain    → POST /stat                            │ resyncChain    → memory.stat()
```

Every store test already runs against an in-memory version of exactly these
seams: the fake server inside `initTestSystem` (`stores/testSystem.ts`). It is
a real chain, not a stub — it keeps the patch table and its order, answers a
stale `parentRef` with a genuine conflict computed from its own chain, omits
unknown ids from `fetchPatches` the way `ValOpsFS` does, deletes on discard,
and serves `.jsonValues()` entries from the modules' own import thunks. Its
code is plain TypeScript; jest is only in the recording and assertion helpers
around it (`Ledger`, `matches`).

So option C is:

1. **Extract that fake server** into `stores/memoryServer.ts` — the patch
   table, the ordered chain, the head check, discard, `fetchPatches`,
   `fetchJsonEntry` — with a `stat()` that returns the current snapshot.
   `initTestSystem` builds on it and keeps its failure injection (held writes,
   queued failures) as a wrapper. From then on, **every store test exercises
   the code the demo runs.** That is the whole argument for C: the demo backend
   is not a fake anyone has to keep honest, it is the fake the ~40 store test
   files already depend on.
2. **`createDemoSystem(memory)`** calls `createSystem` with the memory seams,
   the worker validation bridge (`createSchemaValidationBridge`, as
   `createValSystem` does), `mode: "fs"` (auto-save, no deployments), and no
   `uploadFile`, `publishPatches` or `requestPublish`.
3. **Persistence**: the memory server writes its chain to `sessionStorage` on
   every change and reads it back on load; `receiveStat` then announces the
   ids and the patch store fetches them through `fetchPatches` like any other.

**The part that is not seam-shaped is `ValProvider`.** It builds the system
itself (`createValSystem(client, …)`, `components/ValProvider.tsx` ~746), and
it runs `useStatus(client)` (~442), a ~1000-line hook that long-polls
`/stat` and is the source of about twenty things the rest of the Studio reads:
whether to show the login dialog, `mode`, `config`, `profileId`, the chain and
head that `ValStoreProvider` feeds into `system.stat.receiveStat`, deployments,
commits, proposal state. Two ways through it:

- **C-lite: inject the system, keep `useStatus`.** `ValProvider` takes an
  optional system factory; the demo passes `createDemoSystem`. `/stat` and
  `/profiles` are still answered by a tiny demo `ValClient`, but from the
  SAME memory server object, so the two cannot disagree. The `/stat` answer has
  to carry the bundle's own `sourcesSha` and `schemaSha` (otherwise
  `BaseAlignment` and `SchemaFreshnessWatch` go looking for another build),
  read from the system's `HostStore` rather than computed twice. And it has to
  block until the chain changes, like fs mode does, or `useStatus` re-polls in
  a tight loop.
- **C-full: also replace `useStatus`.** Introduce a status source that
  `ValProvider` reads instead of calling `useStatus` directly; the demo one is
  synthesized from the memory server and needs no `/stat` at all — no long
  poll, and `receiveStat` can be called without the hashes (which is what the
  test rig does, and means "the bundle's own build"). Cleaner, but it means
  changing how the Studio's largest component gets its status, for a demo.

The other direct `client(...)` calls are features the demo hides (AI, History,
Val Build access, link checks, remote settings, uploads), plus `/profiles` and
the patch-error report download in `DraftChanges` — those two are answered by
the demo client in either flavour.

- **For:** no second fake; the patch path is the most-tested code in the
  Studio. No wire shapes to imitate for the patch routes, no zod response
  validation to satisfy, no status codes to map.
- **Against:** touches `ValProvider`, the Studio's central component, where A
  touches only `App.tsx`. The demo still needs a small `ValClient` for `/stat`
  (C-lite) or a status-source refactor (C-full). And the code that turns HTTP
  into seams — `createValSystem` — is skipped, so the demo exercises less of
  the real Studio than A does (it is well covered by its own tests, though).
- **Size:** S–M for C-lite (the extraction is mechanical; the `ValProvider`
  change is one optional parameter). M for C-full.

**Decision: B.** The question that decided it is "what breaks the demo
when we add a feature?":

| A feature that…                                | A (demo client)                                            | C-lite (store seams)                                        | B (real server in the tab)         |
| ---------------------------------------------- | ---------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------------- |
| adds a route the Studio calls                  | demo answers nothing until someone writes it               | same, through the demo `/stat`/client                       | works                              |
| changes the `/stat` shape or the head protocol | fake must be updated by hand; the contract test catches it | demo `/stat` by hand; the test fake follows the store tests | works                              |
| adds a seam to `createValSystem`               | works                                                      | silently absent from `createDemoSystem`                     | works                              |
| adds a Node import to the server               | works                                                      | works                                                       | CI fails with a message saying why |

A and C-lite each mean keeping a second implementation in step, and both find
out late when they fall behind. B puts the one way it can break in CI, at the
moment someone causes it.

## 4. The canvas page in demo mode

The page in the canvas iframe is the site itself, rendered by the demo app. Its
provider (`ValTanStackProvider`) currently mounts the canvas bridge only when
`mountOverlay` (the `val_enable` cookie) and `isCanvas` are both true, finds
out whether draft mode is on by polling `GET /api/val/draft/stat`, and
`CanvasFrame` navigates a frame that is not in draft mode through
`/api/val/enable?redirect_to=…`. None of that can work without the server.

In demo mode the provider:

- mounts the bridge when `isCanvas`, with no cookie,
- reports `draftMode: true` in its `ready` message, so `CanvasFrame` never
  redirects it,
- skips the `/draft/stat` poll and the hidden `/draft/enable` iframe,
- does not call `router.invalidate()` on a change (it would re-run loaders
  against published content),
- mounts nothing on a page that is not in the canvas.

**The template must read content with the client hooks** (`useVal` and
friends), not in loaders through `initValContent`. Server-rendered reads come
from a server that never sees the tab's patches, so they would show published
content forever. On TanStack the hooks are already the recommended reader:
they render the published content on the server, and the Studio's snapshot of
pending sources arrives over `postMessage` as soon as the frame reports ready.

### The Studio's own assets

The Studio's JS and CSS are loaded from `/api/val/static/{VERSION}/…`, served
by the app's own `/api/val` route. The demo app keeps that route, **serving
static assets only**: in demo mode every other path answers 404 with "not
available in the demo". That is the app's own static-file route — no Val
service is reached, nothing is authenticated, and there is no content or patch
endpoint on the deployment for anyone to call.

## 5. Files and images: read-only

Uploading is where it gets expensive:

- the upload is a raw `XMLHttpRequest` to `{baseUrl}/patches/{id}/files`, not
  a `ValClient` call;
- an unpublished file is shown at `/api/val/files/…?patch_id=…`, a URL
  `Internal.mediaUrl` builds into the source (`core/src/source/media.ts`), so
  both the Studio's thumbnail and the canvas page's `<img>` request it from the
  app's server, which has never seen the bytes.

Making that work needs either a Service Worker intercepting `/api/val/files`
or a new `blob:` escape hatch in core's `mediaUrl`. Neither is worth it for a
first demo.

So in demo mode:

- **Works:** showing every published image, file and video (they are plain
  static files of the app, `/val/...`); picking an existing entry from a
  gallery (`ModuleMediaPicker` writes a plain `replace` with just the path —
  no file op); editing `alt`, the hotspot, captions and other authored fields.
- **Off:** upload, drop, replace-with-new-file and delete-from-gallery. The
  entry points are `ImageField`, `FileField`, `VideoField`, `ModuleGallery`,
  `useImageUpload`, the image button in `RichTextField`, and the upload seam in
  `ValFieldProvider`. One capability on the Studio's context (for example
  `canUploadFiles`) disables them, with a tooltip that says uploads are not
  part of the demo — rather than seven separate demo checks.

If we later want uploads, a Service Worker answering `/api/val/files` and the
upload URL from the same in-tab store is the way, and nothing above has to
change for it.

## 6. How demo mode is switched on

Build-time; a demo is a property of a deployment, never something a visitor
can turn on. Three places need to know: `ValApp` (which client the Studio
uses), the site's `ValProvider` (the canvas behaviour in section 4), and the
`/api/val` route (static only).

1. **One env var in the template, passed to each (decided).** The template
   reads `VITE_VAL_DEMO` once and passes `demo` to `ValApp`, `ValProvider` and
   `initValServer`. `ValApp`'s config already reaches the Studio through the
   sessionStorage config channel (`useConfigStorageSave` → `useConfig`), so
   the Studio gets it with no new plumbing. The in-tab server is a lazy chunk
   of the Studio bundle, so a normal app downloads none of it.
2. **`initVal({ demo: true })` in `val.config.ts`.** One place reaches all
   three. But `val.config.ts` is also evaluated by the CLI and the language
   server, the flag is a deployment concern living in content config, and it
   is easy to leave on.
3. **A separate entrypoint, `@valbuild/tanstack/demo`**, exporting
   `ValDemoApp` / `ValDemoProvider`. Clean, but a third copy of two components
   that `@valbuild/tanstack` deliberately keeps in step with `@valbuild/next`.

Guards:

- Demo mode refuses to start alongside `VAL_API_KEY` / `VAL_SECRET` or
  `files: { remote: true }`, with an error that names the conflicting setting.
- The Studio shows a permanent banner: "Demo — your changes stay in this
  browser", with **Reset demo** (clears the stored chain, reloads) and
  **Create your own project**.
- Hidden in demo: Publish, History, the assistant, the project switcher,
  sign-in/sign-out, deployments and Val Build access.

## 7. Later: the demo template and the Studio tour (to discuss)

Not part of this plan's work, listed so we discuss them before building:

- **A dedicated template** in `valbuild/templates` (e.g. `tanstack/demo`), not
  `examples/tanstack`: the showcase covers every feature; the demo should show
  the handful that sell Val, read content with client hooks only, and have a
  well-stocked image gallery so read-only media still feels real.
  (`.jsonValues()` needs no special care: memory mode serves it.)
- **A guided tour** through the Studio: click a heading in the canvas → edit
  it → see it change → pick a different image from the gallery → reorder a list
  → see validation catch a mistake. Built into `@valbuild/ui` behind demo
  mode, or a layer the template adds? Driven by Studio events (the activity
  channel) so a step waits for "the visitor did it" rather than "the visitor
  clicked Next"? Skippable, resumable after a reload?
- **Where it lives:** `val.build/demo`? Linked from `npm create @valbuild`?
- **Conversion:** what "Create your own project" does.
- **Measuring it:** do we want to know how far people get through the tour,
  and is that compatible with "nothing leaves the tab"?
- **A head start:** should the demo open with a few edits already made, so
  "unsaved changes" and the change list have something to show? Undecided;
  easy to add later, since it is only an initial state for the patch store.

## 8. Decisions and build order

Decided:

1. **Backend:** option B, the real client, router and memory-mode server in
   the tab.
2. **Switch:** `VITE_VAL_DEMO` in the template, passed as `demo` to `ValApp`,
   `ValProvider` and `initValServer`.
3. **Storage:** one demo per tab -- the patch store is backed by
   `sessionStorage`. A fresh tab is a fresh demo.
4. **Pre-made edits:** not decided; moved to section 7.
5. **`.jsonValues()`:** supported as a consequence of B; nothing to decide.

Build order, each step mergeable on its own and each leaving the non-demo
Studio exactly as it was:

1. **Split `packages/server`** into a browser-safe core and a Node entry
   (section 3's table), and land the **import guard** with it. The guard comes
   first so the split cannot regress while the rest is built. Run `val
validate` against `examples/next` afterwards, per `.claude/CLAUDE.md`: the
   split moves code the CLI loads.
2. **The in-tab server:** an optional `fetch` on `createValClient`, the router
   wired to a memory-mode `ValServer`, and a `sessionStorage`-backed
   `ValPatchStore`. Lands with the **in-tab round-trip** jest test.
3. **The Studio in demo mode** (`packages/ui`): `App.tsx` builds the in-tab
   client when the config says `demo`, as a lazy chunk; the banner with Reset;
   Publish, History, the assistant, sign-in and the project switcher hidden;
   the `canUploadFiles` capability turning off the upload entry points.
4. **TanStack** (`packages/tanstack`): `demo` on `ValApp`, `ValProvider` and
   `initValServer`; the canvas behaviour of section 4; the static-only route;
   the guards of section 6.
5. **The demo e2e:** `examples/tanstack` built with `VITE_VAL_DEMO`, driven by
   Playwright in the blocking `smoke` job, in Chromium and in `webkit-http`,
   with every non-static `/api/val` request failed.
6. **Later, after the discussion in section 7:** the demo template and the
   tour.

A changeset goes with the steps that change published packages (1--4).
