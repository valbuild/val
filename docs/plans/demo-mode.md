# Demo mode: try the Studio with no account and no backend

> **Status: proposal, not started.** Section 7 (the demo template and the
> Studio tour) is a placeholder to discuss separately.

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

| Route                                                                                                  | Who calls it                                                     | Demo answer                                                                         |
| ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `POST /stat` (×3)                                                                                      | `useStatus`, `createValSystem` (chain, schema freshness)         | 200, fs-shaped, the demo's chain; long-polls on a promise, never busy-loops         |
| `PUT /patches`                                                                                         | `createValSystem` save seam                                      | append, with the real `parentRef` head check (409 on a stale head)                  |
| `GET /patches` (×2)                                                                                    | `createValSystem`, `DraftChanges`                                | the stored records                                                                  |
| `DELETE /patches`                                                                                      | discard                                                          | drop them                                                                           |
| `GET /profiles`                                                                                        | `ValProvider`                                                    | one profile, "You"                                                                  |
| `GET /json`                                                                                            | `.jsonValues()` entries                                          | from the module's entry thunks — or the demo template does not use `.jsonValues()`  |
| `PUT /sources/~`                                                                                       | `BaseAlignment`, only when `/stat`'s `sourcesSha` ≠ the bundle's | never needed if `/stat` reports the bundle's own `sourcesSha` (`computeSourcesSha`) |
| `POST /direct-file-upload-settings`                                                                    | uploads                                                          | not reached: uploads are off                                                        |
| `/save`, `/history/*`, `/ai/*`, `/admin/status`, `/remote/settings`, `/external-urls/check`, proposals | publish, History, assistant, Val Build access, link checks       | not offered in demo; answer a typed "not available in the demo" if reached          |

Two hashes have to be right or the Studio will try to fetch things that do not
exist: `/stat`'s `sourcesSha` must equal what `HostStore` folds from the
bundle, and its `schemaSha` must equal the bundle's (see
`SchemaFreshnessWatch`). Both are computed in the tab from the same modules
with the same functions the server uses, so the demo backend computes them
rather than inventing them.

That is **seven routes, all of them going through `ValClient`**. Nothing here
needs a Service Worker: the side channels that bypass `ValClient` (the upload
`XMLHttpRequest`, `/api/val/files?patch_id=…` image URLs, the `/enable`
navigation) are all out of scope.

## 3. Options for the in-tab backend

### Option A — A demo `ValClient` (recommended)

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

### Option B — Real `ValServer` in memory mode, in the tab

Run the actual server, wrapped as a `ValClient`. No second implementation at
all — but `packages/server` is not browser-bundleable today: `ValServer.ts`
statically imports `ValOpsFS` (fs, os, crypto), `ValOpsHttp` (node crypto),
`linkCheck/probeUrl.ts` (`node:http`/`https`/`net`), `jwt.ts`, `path`, and
`ValOps.ts` imports `typescript`. All fixable (lazy op selection, a posix `path`
shim, `Uint8Array` for `Buffer`), but it is a refactor of the server package
and a much larger Studio bundle, to serve seven routes.

- **Size:** M. Worth revisiting only if the demo grows to include publish.

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

**Recommendation: A or C-lite; to decide.** They cost about the same. A keeps
every change out of the Studio's components and pays for it with a fake that
needs a contract test. C-lite reuses the fake the store tests already trust and
pays for it with one injection point in `ValProvider` and a demo `/stat`.

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

1. **One env var in the template, passed to each (recommended).** The template
   reads `VITE_VAL_DEMO` once and passes `demo` to `ValApp`, `ValProvider` and
   `initValServer`. `ValApp`'s config already reaches the Studio through the
   sessionStorage config channel (`useConfigStorageSave` → `useConfig`), so
   the Studio gets it with no new plumbing. The demo client is a lazy chunk of
   the Studio bundle, so a normal app downloads none of it.
2. **`initVal({ demo: true })` in `val.config.ts`.** One place reaches all
   three. But `val.config.ts` is also evaluated by the CLI and the language
   server, the flag is a deployment concern living in content config, and it
   is easy to leave on.
3. **A separate entrypoint, `@valbuild/tanstack/demo`**, exporting
   `ValDemoApp` / `ValDemoProvider`. Clean, but a third copy of two components
   that `@valbuild/tanstack` deliberately keeps in step with `@valbuild/next`.

Guards, whichever we pick:

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
  the handful that sell Val, read content with client hooks only, use no
  `.jsonValues()` (or we answer `/json` from the entry thunks), and have a
  well-stocked image gallery so read-only media still feels real.
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

## 8. Open questions

1. One demo per tab (`sessionStorage`) or one per browser (`localStorage`)?
   Per tab is the proposal: a fresh tab is a fresh demo.
2. Should the demo start with some pending edits already in the chain, so
   "unsaved changes" and the change list have something to show?
3. Is `/json` worth supporting, or does the template just avoid `.jsonValues()`?
4. Option 1 vs 2 in section 6: is an env var passed in three places acceptable,
   or do we want the single `val.config.ts` switch despite its risks?
