# Demo mode: try Val with no account and no backend

> **Status: proposal, not started.** Options for discussion. Nothing here is
> built yet. Section 6 (the demo template and the Studio tour) is a placeholder
> to discuss separately.

The goal: someone who has never heard of Val opens a link, gets a real site with
the real Studio beside it, and can edit, upload an image, see the page change
and press Publish — **without signing in and without one request reaching a Val
API**. Everything lives in their browser session and is gone when they reset or
leave.

The good news, and the reason this is smaller than it sounds: almost every
piece already exists. What is missing is a place for "the server" to run that is
not a server.

---

## 1. What the Studio needs from a backend today

The Studio is closer to a pure client than it looks.

- **Schemas and sources need no server.** The app puts its modules on
  `window.__VAL_MODULES__` (`next/src/ValModulesClient.tsx`, tanstack copy), and
  the Studio evaluates them in the tab (`ui/spa/hooks/useValModules.ts`,
  `ui/spa/stores/react/ValStoreProvider.tsx`). `/schema` is not called.
- **Patches are applied in the tab.** `SourceStore` applies the chain on top of
  the base. The server's job is to _persist and order_ patches (one linear chain,
  `parentRef` checked, 409 on a stale head). It does not apply or validate them
  on the way in.
- **Validation runs in a worker in the tab** (`ValidationStore`,
  `createSchemaValidationBridge`).
- **The site preview is fed by events, not fetches.** Client hooks (`useVal`)
  read `ValExternalStore`, which is filled by `"val-event"` window events: from
  `ValOverlayEmitter` in the same window, or re-dispatched by `ValCanvasBridge`
  from the Studio's `postMessage` in the canvas iframe.

What it calls the server for, all through `/api/val`:

| Need                       | Endpoint                                                                 | Goes through `ValClient`?                          |
| -------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------- |
| Session / "am I logged in" | `POST /stat` (401 → `LoginDialog`)                                       | yes                                                |
| Patch chain and head       | `POST /stat` (long-poll in fs/memory mode; WebSocket only in http mode)  | yes                                                |
| Save / load / drop patches | `PUT`, `GET`, `DELETE /patches`                                          | yes                                                |
| Base sources after a move  | `PUT /sources/~?apply_patches=false`                                     | yes                                                |
| `.jsonValues()` entries    | `GET /json`                                                              | yes                                                |
| Publish                    | `POST /save`                                                             | yes                                                |
| Upload a file              | `POST {baseUrl}/patches/{id}/files` via `/direct-file-upload-settings`   | **no** — raw `XMLHttpRequest` (`createValSystem`)  |
| Show an unpublished image  | `<img src="/api/val/files/...?patch_id=…">` (`core/src/source/media.ts`) | **no** — a URL baked into source by `mediaUrl`     |
| Studio JS and CSS          | `/api/val/static/{VERSION}/…`                                            | **no** — `<script>` / `<link>`                     |
| Draft mode for the site    | `GET /draft/stat` poll, `/enable`, `/draft/enable` iframe                | partly; `/enable` is a navigation that sets cookie |
| Optional                   | `/profiles`, `/history/*`, `/ai/*`, `/remote/settings`, proposals, …     | mostly; a few raw `fetch`es                        |

The last three columns are what decides the options below: **a fake
`ValClient` alone is not enough**, because uploads, draft media, the Studio's
own assets and the draft-mode handshake do not go through it.

## 2. The backend already exists: memory mode

`packages/server/src/ValOpsMemory.ts` (marked EXPERIMENTAL) is a `ValOps` with
no filesystem and no git. It is selected by `ValServer`'s `mode: "memory"`, and
it takes:

- `sourceFiles: Record<string, string>` — the project's `.val.ts` text,
- `patchStore?: ValPatchStore` — pluggable, defaulting to `InMemoryPatchStore`,
- `unsafelyAllowUnauthenticated?: boolean` — skip the session check.

It implements the whole chain (head check, long-poll `/stat`, file staging,
`/save` that rewrites the `.val.ts` text and adopts it as the new base) and has
its own test suite. TanStack's `initValServer` / `initValContent` already wire
it through. History answers `not-supported-in-fs-mode`, which the Studio
already handles by hiding History.

So the demo backend is **"run `ValServer` in memory mode somewhere in the
browser"**, not "write a new fake server". That matters: the repo's stance
(see "Proxy mode" in `.claude/CLAUDE.md`) is that a second fake of a real
service in shipped code drifts with nothing testing it.

What stops `ValServer` from being bundled for a browser today — all static
imports, none of them used in memory mode:

- `ValServer.ts` imports `ValOpsFS` (fs, path, `patchLock`'s os/crypto) and
  `ValOpsHttp` (`proposalMerge/*`, node `crypto`).
- `linkCheck/probeUrl.ts` (`node:http`, `node:https`, `node:net`).
- `jwt.ts` (`crypto.timingSafeEqual`, `Buffer`).
- `path` in `ValServer.ts`, `rewriteDraftPlaylist.ts`, `patch/jsonValuesPatch.ts`,
  `history/getJsonEntryAtCommit.ts`.
- `Buffer` throughout (`StoredFile.data` and several places in `ValServer.ts`).
- `typescript` and `image-size` in `ValOps.ts` — browser-capable, but
  `typescript` is large. It is only needed by `/save` (rewriting `.val.ts` text).

None of these is hard: make the mode-specific ops lazy (or select them through
an injected factory), use a posix `path` shim, and either polyfill `Buffer` or
move the memory store to `Uint8Array`. A side benefit: the same work makes
memory mode cheaper in a Worker host, which is what it was written for.

## 3. Options for where the backend runs

### Option A — A hand-written in-tab `ValClient`

`createDemoClient()` answers the ~8 essential routes from IndexedDB, and
`App.tsx` / `Overlay.tsx` pick it instead of `createValClient("/api/val")` when
the config says demo. Uploads go through the `uploadFile` seam
`createValSystem` already has; draft media is shown from `blob:` URLs; Publish
folds the chain into the base JSON (no TypeScript).

- **For:** smallest bundle, no changes to `packages/server`, quickest to a
  first clickable demo.
- **Against:** a second implementation of the chain, the head check and
  `/stat` — exactly the kind of fake the repo avoids. `mediaUrl` hardcodes
  `/api/val/files`, so `blob:` URLs need a new escape hatch in core or a
  rewrite step. The draft-mode handshake (`/draft/stat`, `/enable`, the canvas
  frame's `/api/val/enable?redirect_to=`) has to be special-cased in both
  providers and in `CanvasFrame`. The Studio's assets still need `/api/val/static`.
- **Size:** S–M for the Studio side; the special cases are where the time goes.

### Option B — Real `ValServer` (memory mode) in the tab, behind an adapter

Make `packages/server` browser-bundleable (section 2), and wrap
`ServerOf<Api>` as a `ClientOf<Api>`: the server's handler functions are
already plain async functions of a typed request, so the adapter is small.
`ValPatchStore` gets an IndexedDB implementation so a reload keeps the edits.

- **For:** one implementation of the chain; the demo exercises the same code a
  customer's Studio talks to. Publish really rewrites `.val.ts` text, so the
  tour can show the code diff a publish produces — a strong "this is just
  code" moment.
- **Against:** same leftover side channels as A (uploads, draft media, static
  assets, the draft-mode handshake). Two documents (the `/val` Studio page and
  a site page with the overlay) each get their own server instance, so they
  must share the IndexedDB store and coordinate over `BroadcastChannel` — the
  linear chain wants ONE authority. `typescript` is a large lazy chunk loaded on
  Publish.
- **Size:** M. Most of it is the import surgery in `packages/server`, which is
  worth doing anyway.

### Option C — Real `ValServer` in a Service Worker answering `/api/val/*` (recommended)

Same backend as B, but hosted in a Service Worker scoped to the demo site. It
intercepts every request to `/api/val/*` — `fetch`, `XMLHttpRequest`, `<img>`,
`<script>`, `<link>` and navigations alike.

- **For:** **no changes to the Studio's network code at all.** Uploads,
  `/api/val/files?patch_id=…` image URLs, the draft-mode poll, `/enable` and
  the canvas frame's redirect all keep working as written. One Service Worker
  is one instance for every tab and the canvas iframe, so the single-writer
  chain holds without coordination. The Studio's JS and CSS can be precached,
  so the demo can be a fully static deployment on any CDN.
- **Against:**
  - Service Worker lifecycle: it does not control the page that registered it
    until a reload or `clients.claim()`; the first visit needs a "starting
    demo…" gate so no `/api/val` request escapes to the network.
  - A synthesized `Response` cannot set cookies. `val_enable` and draft mode
    are cookies today, so the demo providers set them via `document.cookie` (or
    treat draft mode as always on, which is what a demo wants anyway).
  - Needs a secure context (HTTPS or `localhost`). Fine for a hosted demo;
    note the repo has `e2e/insecure-context.spec.ts` for a reason, and demo
    mode must refuse to start (with a message saying why) rather than half-work.
  - The Service Worker must contain the project's modules (`val.modules.ts`)
    to give `ValServer` its schemas, so the demo build needs a second entry.
    A new Vite plugin from `@valbuild/tanstack` is the natural home (there is
    none today).
- **Size:** M–L. B's server work plus the worker build and its lifecycle.

### Option D — A hosted demo server (baseline, not what was asked)

Deploy a TanStack demo app with memory mode and `unsafelyAllowUnauthenticated`,
one patch store per visitor (keyed by an anonymous cookie, expired after an
hour). This works **today** with no Val changes beyond a per-visitor store.

- **For:** zero client work; server-rendered content updates too.
- **Against:** it calls our servers, which is what this plan is meant to
  avoid: cost per visitor, abuse surface (anonymous uploads), state to expire.
  Useful as a throwaway prototype to build and test the tour before C lands.

### Recommendation

**C, built in two steps:** first B's server work (browser-bundleable
`ValServer` in memory mode + an IndexedDB `ValPatchStore`, verified by running
the existing `ValOpsMemory.*.test.ts` against the new store), then host it in a
Service Worker. If we want something clickable for the tour in the meantime,
D is a day of work and throws nothing away — the tour does not care where the
server is.

## 4. How demo mode is switched on

All of these are build-time; a demo is a property of a deployment, never
something a visitor can turn on.

1. **A separate entrypoint, chosen by an env var in the template
   (recommended).** `@valbuild/tanstack/demo` exports `ValDemoProvider` and a
   `valDemo()` Vite plugin that builds the Service Worker. The demo template
   does `import.meta.env.VITE_VAL_DEMO ? ValDemoProvider : ValProvider`. A
   normal app never imports the demo code, so nothing ships to customers.
2. **A server-side env var (`VAL_DEMO=true`) read by `initValServer` and passed
   to the client as `config.demo`** through the existing sessionStorage config
   channel (`useConfigStorageSave` → `useConfig`). Simple, but the demo code is
   then in every app's bundle (lazy, but present) and the flag can be left on by
   mistake in a real deployment.
3. **`initVal({ demo: true })` in `val.config.ts`.** Project config like
   `files: { remote: true }`. Visible in code review, but the same "left on in
   production" risk as 2, and it puts a deployment concern in content config.
4. **A separate build of `@valbuild/ui`** (a `VITE_VAL_DEMO` define in the SPA
   build). Clean tree-shaking, but doubles the release artifacts and the
   static-asset upload. Not worth it.

Whichever we pick, two guards:

- Demo mode refuses to combine with `VAL_API_KEY` / `VAL_SECRET` / remote
  media, with an error that says which setting conflicts.
- The Studio shows a permanent, non-dismissable banner: "Demo — your changes
  stay in this browser", with **Reset demo** and **Create your own project**.

## 5. What the Studio does differently in demo mode

Small, and each is a single branch on `mode` (memory mode already reports
`mode: "fs"` on `/stat`; demo should report its own value so the Studio can
tell).

- **Login:** never shown. `/stat` answers 200; `/profiles` returns one fake
  "You" profile so authorship UI has something to show.
- **Publish:** runs `/save` in the worker, which rewrites the `.val.ts` text
  and adopts it as the new base; the Studio's `BaseAlignment` sees the new
  `sourcesSha` and refetches `/sources/~`. The success state should say what
  would have happened in a real project ("this is a commit to your GitHub
  repository") and offer the code diff.
- **Hidden or stubbed:** AI assistant (calls our API), History (already hidden
  in fs mode), project switcher, remote media, external link checks
  (`/external-urls/check` would reach the internet from the worker — answer
  `skipped`), proposals, publish jobs, deployments.
- **Reset:** clears the IndexedDB store and reloads.
- **Storage:** IndexedDB for patches and uploaded files (sessionStorage is ~5 MB
  and images do not fit), keyed by a per-tab session id so two tabs can be two
  demos if we want — or one shared demo if we key by origin. To decide.

### What the site can and cannot show

Edits reach the page through the client store (`useVal`). Content rendered on
the **server** (Next RSC `fetchVal`, TanStack loaders calling
`initValContent`) is read by a server that never sees the browser's patches, so
it would not update. The demo template therefore has to read content with
client hooks only — which on TanStack is already the recommended way — and the
demo is **TanStack only** to start (TanStack is the primary target, and Next's
RSC path is server-side by construction). Prerendering the template to static
HTML keeps hosting free.

## 6. Later: the demo template and the Studio tour (to discuss)

Not part of this plan's work, listed so we discuss them before building:

- **A dedicated template** in `valbuild/templates` (e.g. `tanstack/demo`), not
  `examples/tanstack`: the showcase is meant to cover every feature, the demo
  should cover the five that sell Val and look good doing it. Which five?
- **A guided tour** through the Studio: click a heading on the page → edit it
  → see it change → upload an image → reorder a list → Publish → see the code
  diff. Questions: built into `@valbuild/ui` behind demo mode, or a layer the
  template adds? Driven by `data-val-path` and Studio events (the activity
  channel, `window.__VAL_STORES__`) so it can wait for "the visitor did it"
  rather than "the visitor clicked Next"? Skippable, resumable after a reload?
- **Where it lives:** `val.build/demo`? Linked from `npm create @valbuild`?
- **Conversion:** what "Create your own project" does — a template picker, or
  `npm create @valbuild` with this template pre-selected.
- **Measuring it:** do we want to know how far people get through the tour, and
  does that conflict with "no calls to our APIs"?

## 7. Open questions

1. Is a hosted prototype (Option D) acceptable as a stepping stone, or must the
   first version already be browser-only?
2. Should Publish in the demo rewrite `.val.ts` text (lazy-loading `typescript`,
   several MB) to show the code diff, or just fold patches into JSON and say
   what would have happened?
3. One demo per tab, or one per browser?
4. Image uploads in v1, or text-only first? (C makes uploads free; A does not.)
5. Do we want the demo flag to exist for Next.js at all?
