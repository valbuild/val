# Live Mode — committed patches rendered for anonymous end users

## Context

Today Val renders **exactly what was compiled into the deploy**. `*.val.ts` sources are plain
JS objects in the bundle; both `fetchVal` (RSC) and `useVal` (client) collapse to
`stegaEncode(selector, { disabled: true })` for anyone without draft mode
(`packages/next/src/rsc/initValRsc.ts`, `packages/next/src/client/initValClient.ts`).

Patches are only ever applied for a logged-in editor, and even then only the _uncommitted_ ones:
`ValOps.analyzePatches` skips every patch with `appliedAt` set
(`packages/server/src/ValOps.ts:261`). So after an editor hits **Save**, the change is committed to
git and recorded in the cloud — but nobody sees it until CI rebuilds and redeploys. On a large site
that is minutes; if the deploy pipeline is broken it is never. Editors see the same stale content
as end users.

**Live mode** closes that gap: an opt-in config flag that makes the app render committed patches
that are not yet in the running deploy, for _everyone_, with no login and no cookie. It is
deliberately shaped like the `suspend` opt-in from PR #431 — a single config/prop switch that
changes which source `stegaEncode` reads, with all the plumbing hidden behind it.

Two things make this non-trivial and drive the design:

- The app must ask the cloud "what changed since my commit?" on every request unless we cache. So a
  **cache TTL is mandatory** when live mode is on (0 is allowed, meaning always refetch).
- **The commit sha does not identify a deploy.** The same commit can be deployed many times, and
  the evaluated sources can differ between those deploys (a dependency bump changes `baseSha`
  without changing the commit). Anything cached must therefore be keyed on `baseSha` as well as the
  commit, and the cloud must never assume commit ⇒ deploy identity.

Decisions already taken: RSC + client hooks + route resolution are all in scope; live sources reach
client components via a fetch after hydration; a new dedicated cloud endpoint; stale cache preferred
over fallback on failure; proxy (http) mode only.

---

## Data flow

```
content.val.build                    Next.js app (ValServer, in-process)          Browser
─────────────────                    ──────────────────────────────────           ───────
GET /v1/{project}/live/patches   ←   ValOpsHttp.fetchLivePatches()
  ?branch&commit&base_sha              └ LiveCache: ttl + stale-while-revalidate
                                          + stale-if-error   (keyed on
                                          project|branch|commit|baseSha|coreVersion)
  → { headCommitSha, patches[] }
                                     ValOps.analyzePatches(…, {includeApplied:true})
                                     ValOps.getSources(analysis)
                                       └ Record<ModuleFilePath, Json>  (changed modules only)
                                            │
                        ┌───────────────────┴────────────────────┐
                        │                                        │
              fetchValStega (RSC)                    GET /api/val/live/sources  →  ValProvider
              stegaEncode(sel, {getModule})          (unauthenticated, Cache-Control)   └ valStore.update()
                                                                                        └ useValStega
```

Nothing new is invented for patch application: `analyzePatches` + `getSources` are the exact
functions the editor path already uses, and `stegaEncode`'s `getModule(path)` callback
(`packages/react/src/stega/stegaEncode.ts:406`) is the single override seam both surfaces already
funnel through.

---

## Part 1 — content.val.build (separate repo)

This is the hand-off prompt for the cloud repo. Ship it before the client work; the app side can be
developed against a stub.

### New endpoint

```
GET /v1/{org}/{project}/live/patches
  ?branch=<string>            required — the deploy's git branch
  &commit=<sha>               required — the deploy's git commit (VAL_GIT_COMMIT)
  &base_sha=<sha>             required — the deploy's evaluated baseSha (see below)
  &core_version=<semver>      required
Authorization: Bearer <VAL_API_KEY>          (same auth as /applicable/patches)
```

Response `200`:

```jsonc
{
  "headCommitSha": "…", // newest commit on `branch` known to the cloud
  "baseCommitSha": "…", // echo of the requested `commit`
  "patches": [
    {
      "patchId": "…",
      "path": "/content/authors.val.ts",
      "patch": [
        /* patch ops */
      ],
      "baseSha": "…",
      "createdAt": "…",
      "authorId": "…",
      "appliedAt": { "commitSha": "…" }, // always non-null on this route
    },
  ],
}
```

Semantics — deliberately _narrower_ than `/applicable/patches`:

1. **Committed only.** Every returned patch has `appliedAt.commitSha` set. Uncommitted drafts must
   never appear here; this response is served to anonymous end users.
2. **Not-yet-deployed only.** Return patches whose `appliedAt.commitSha` is a descendant of the
   requested `commit` on `branch` — i.e. landed _after_ the deploy's commit. If `commit` is unknown
   or not an ancestor of head (force-push, rollback to a detached sha), return
   `{ headCommitSha, baseCommitSha, patches: [] }` with a `x-val-live-degraded: unknown-base`
   header rather than an error. Falling back to deployed content is always safe; guessing is not.
3. **Ordered** oldest → newest, same ordering guarantee as `/applicable/patches` — the app applies
   them in sequence.
4. **No `patch_id` filter, no chunking.** Avoid the "returns everything regardless of filter" trap
   documented at `packages/server/src/ValOpsHttp.ts:611-633`.

### Caching contract

- `ETag` on the response, derived from `(branch, commit, headCommitSha, set of patch ids)`. Honour
  `If-None-Match` with `304`.
- `Cache-Control: public, max-age=<small>, stale-while-revalidate=<larger>` — the app sends its own
  TTL, but the cloud must not depend on the app honouring it.
- **Do not key any cache on deploy identity.** Several deploys can share one commit sha, and one
  commit sha can correspond to different evaluated sources. `commit` + `base_sha` together are the
  cache key; `base_sha` is opaque to the cloud but must be part of the key and echoed back so the
  app can detect a mismatched response.
- This endpoint is read-only and hot. Prefer a CDN/edge cache in front of it.

### Retention requirement (blocking)

`GET /v1/{project}/patches/{patchId}/files` **must keep serving binary files for patches that have
already been committed**, for as long as any deploy might still be live-rendering them.

Why: an image added by a committed-but-undeployed patch does not exist in the deployed bundle. The
app injects `patch_id` into the image source (`ValOps.getSources`, the `op.op === "file"` branch) so
the URL becomes `/api/val/files/public/val/x.jpg?patch_id=…`, which the app resolves via that cloud
route. If patch files are garbage-collected on commit, live mode renders broken images.

If retention is not acceptable, the alternative is a commit-scoped file read
(`PUT /v1/{project}/files` already supports `{ location: "repo", commitSha }`) — but that requires
changing `convertFileSource`'s URL rules in `@valbuild/core`, so retention is strongly preferred.

### Non-goals for the cloud

No new auth scheme (reuse the API key), no per-request source materialisation (the cloud cannot
evaluate the deploy's TS), no websocket/push channel.

---

## Part 2 — this repo

### 2.1 Config surface

`live` is the on-switch; presence of the object enables live mode. `ttl` is **required** (0 allowed).

```ts
live?: {
  /** Seconds to cache the live patch set. 0 = always refetch. Required. */
  ttl: number;
  /** Seconds past `ttl` a stale entry may be served while refreshing in the background. */
  staleWhileRevalidate?: number;
};
```

Add to every place `ValConfig` is duplicated — grep `gitCommit` to find them all:

- `packages/core/src/initVal.ts` — the canonical `ValConfig` type
- `packages/shared/src/internal/SharedValConfig.ts` — zod, shipped to the studio via `/stat`
- `packages/shared/src/internal/ApiRoutes.ts:25-34` — the inline `ValConfig` zod
- `packages/init/src/templates.ts:60-70` — the template's local copy
- `packages/cli/src/utils/evalValConfigFile.ts:29-30` — CLI config validation

Runtime validation (for JS consumers where the type is not enforced): if `live` is present, `ttl`
must be a finite non-negative number, else throw a config error from `initHandlerOptions` in
`packages/server/src/ValRouter.ts` with the same style as the existing `VAL_GIT_COMMIT` error.

Env overrides, resolved in `initHandlerOptions` alongside `valContentUrl`:
`VAL_LIVE_TTL`, `VAL_LIVE_STALE_WHILE_REVALIDATE`, `VAL_LIVE_DISABLED=true` (kill switch for
preview deploys). Live mode is **proxy/http mode only** — in fs mode, log a one-time warning and
no-op.

### 2.2 Fetch + cache — `packages/server`

**New file `packages/server/src/LiveCache.ts`.** A small TTL + stale-while-revalidate +
stale-if-error cache. Single entry (the live patch set), keyed on
`${project}|${branch}|${commit}|${baseSha}|${coreVersion}`:

- fresh (`age < ttl`) → return
- stale (`ttl <= age < ttl + swr`) → return immediately, kick off a background refresh, dedupe
  concurrent refreshes
- expired → await the refresh; on failure return the stale entry if there is one, else `null`
- `ttl === 0` → always await a fresh fetch (still dedupe within a single tick)

The `baseSha` component of the key is the answer to "several deploys from one commit": a redeploy
whose evaluated sources differ produces a different `baseSha` and therefore never reuses the
previous deploy's entry.

**`packages/server/src/ValOpsHttp.ts`** — add, following the `getCommitMessage` template at
`:1283-1332` (never throw, `safeParse` + `fromError`, `console.error` then return
`{ error: GenericErrorMessage }`):

- `const LivePatchesResponse = z.object({...})` next to `GetApplicablePatches` at `:67`
- `async fetchLivePatches(): Promise<OrderedPatches | { error }>` — `GET
${contentUrl}/v1/${project}/live/patches?branch&commit&base_sha&core_version`, with
  `this.authHeaders`, and `next: { revalidate: ttl }` on the `fetch` options (a no-op outside
  Next, and inside Next it dedupes across instances on top of our in-process cache). `ttl === 0`
  → `cache: "no-store"`.
- Wire the `LiveCache` around it so callers get the cached value.

**`packages/server/src/ValOps.ts`**

- `analyzePatches(sortedPatches, commits?, currentCommitSha?, opts?: { includeApplied?: boolean })`
  — when `includeApplied` is set, drop the `if (patch.appliedAt) continue;` guard at `:261`. Do not
  change the default; the draft path must keep skipping applied patches.
- `async getLiveSources(): Promise<{ sources: Sources; headCommitSha: string | null }>` on the base
  class, returning `{}` for `ValOpsFS`. In `ValOpsHttp`: `fetchLivePatches()` →
  `analyzePatches(patches, undefined, commit, { includeApplied: true })` → `getSources(analysis)`.
  `getSources` already returns **only the modules that had patches**, which is what we want on the
  wire. No validation, no renders, no TS work — this path must stay cheap.

### 2.3 App endpoint — `packages/shared` + `packages/server`

New route in `packages/shared/src/internal/ApiRoutes.ts` (model on `/commit-summary` at `:907`):

```ts
"/live/sources": {
  GET: {
    req: {},                                  // no cookies — anonymous by design
    res: z.union([
      z.object({ status: z.literal(400), json: GenericError }),
      z.object({
        status: z.literal(200),
        headers: z.record(z.string()).optional(),
        json: z.object({
          headCommitSha: z.string().nullable(),
          sources: z.record(ModuleFilePath, z.any()),   // changed modules only
        }),
      }),
    ]),
  },
},
```

Implement in `packages/server/src/ValServer.ts` next to `/files` (`:2585`) and reuse its
justification for skipping auth: **this endpoint only ever returns content that is already
committed and therefore public.** Set
`Cache-Control: public, max-age=${ttl}, stale-while-revalidate=${swr}` (or `no-store` when
`ttl === 0`) — `initValServer`'s response converter already forwards `headers`
(`packages/next/src/server/initValServer.ts`). Return `{ headCommitSha: null, sources: {} }` when
live mode is off or the mode is fs, so the client never needs to branch.

While here: enable the commented-out immutable cache header on `/files` for the `patch_id` branch
(`ValServer.ts:2610`) — those responses are content-addressed and are about to get a lot more
traffic.

### 2.4 RSC — `packages/next/src/rsc/initValRsc.ts`

In `initFetchValStega`, the `if (enabled)` block stays untouched. Add an `else` branch: when live
mode is configured, `await valServer["/live/sources"]["GET"]({})` (in-process call, same style as
the existing `valServer["/sources/~"]["PUT"]` call) and pass the result through:

```ts
return stegaEncode(selector, {
  disabled: !enabled, // stega stays OFF for end users
  getModule: (path) => liveSources[path], // but the source is overridden
});
```

Two constraints:

- **Never read cookies or headers on this path.** `getHost`/`getCookies` are only reached under
  `enabled`. Live mode must not add a dynamic API, or every route loses static generation — the
  hazard PR #431 hit and documented in `packages/next/src/initVal.ts:20-27`.
- `disabled` must stay tied to draft mode, not to live mode, so no `data-val-path` stega markers
  leak into public HTML.

`fetchValRoute` / `fetchValRouteUrl` need no change — they call `fetchVal` internally, so a route
that only exists in a committed patch resolves for free. New routes are not in
`generateStaticParams`; Next's default `dynamicParams: true` renders them on demand. Document this.

### 2.5 Client hooks — `packages/next`

**`ValNextProvider.tsx`** — a new effect, mirroring the existing `val-event` listener at `:287`:
when `props.config.live` is set and the Val Enable cookie is _absent_ (editors keep the draft path),
`fetch("/api/val/live/sources")` after hydration and `valStore.update(path, source)` for each entry.
Re-fetch on an interval of `ttl` seconds when `ttl > 0`. Reuse `hasValEnableCookie` for the check.
Track it in a `liveActive` state and pass it through `ValOverlayProvider` alongside `suspend`.

**`ValOverlayContext.tsx`** — add `live: boolean` to the context. `ValExternalStore` needs no
changes; `loadedSources` / `hasAllLoaded` / `waitForLoad` from PR #431 already do exactly what live
mode needs.

**`client/initValClient.ts`** — `useValStega` currently gates `getModule` on `draftMode`:

```ts
getModule: (moduleId) => {
  if (moduleMap && valOverlayContext.draftMode) return moduleMap[moduleId];
};
```

Change the condition to `draftMode || live`. Extend the Suspense gate the same way — replace
`valOverlayContext.draftMode !== false` with a predicate that also holds when live mode is active,
so `<ValProvider config={config} suspend>` covers the live case too. That is the answer for
client-rendered routes that only exist in a committed patch: without `suspend` the first render
`notFound()`s before the live sources land, exactly as PR #431's changeset describes for drafts.
Keep the `LOAD_TIMEOUT_MS` release valve.

Expected behaviour without `suspend`: build-time content renders first, then swaps once the live
fetch resolves. This is the accepted trade-off of the client-fetch approach — document it, and
recommend `suspend` + `loading.tsx` for routes where it matters.

### 2.6 Editor consistency (same code path, worth doing here)

Today an editor in draft mode also does **not** see committed-but-undeployed content, for the same
`if (patch.appliedAt) continue;` reason. With live mode on, the draft path should start from live
sources and layer uncommitted patches on top, so the editor sees what end users see plus their own
drafts. Concretely: in `ValServer.ts`'s `/sources/~` handler (`:1365`, both the `:1698` and `:1762`
`analyzePatches` call sites), when live mode is on, seed from `getLiveSources()` before applying the
uncommitted analysis. Guard it behind live mode so nothing changes for projects that do not opt in.

### 2.7 Supporting changes

- `packages/init` — teach `transformNextAppRouterValProvider` nothing new (no JSX change needed),
  but the generated `val.config.ts` template should carry a commented-out `live: { ttl: 60 }` block
  with a one-line explanation.
- `examples/next/val.config.ts` — enable `live: { ttl: 60, staleWhileRevalidate: 300 }` so the
  example app exercises it. Note `project` is currently commented out there; re-enabling live mode
  locally requires proxy mode.
- `packages/next/README.md` — a Live mode section: what it does, the TTL contract, the
  no-flash caveat for client components, and that it requires `VAL_GIT_COMMIT`/`VAL_API_KEY`.
- A changeset (`.changeset/*.md`) — `@valbuild/core`, `@valbuild/shared`, `@valbuild/server`,
  `@valbuild/next` minor.

---

## Files to touch

| Area                      | File                                                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Config type               | `packages/core/src/initVal.ts`                                                                                                                |
| Config zod (×3)           | `packages/shared/src/internal/SharedValConfig.ts`, `packages/shared/src/internal/ApiRoutes.ts`, `packages/cli/src/utils/evalValConfigFile.ts` |
| Route contract            | `packages/shared/src/internal/ApiRoutes.ts` (`/live/sources`)                                                                                 |
| Cache                     | `packages/server/src/LiveCache.ts` _(new)_                                                                                                    |
| Cloud fetch               | `packages/server/src/ValOpsHttp.ts`                                                                                                           |
| Patch analysis / apply    | `packages/server/src/ValOps.ts`                                                                                                               |
| App endpoint              | `packages/server/src/ValServer.ts`                                                                                                            |
| Config resolution         | `packages/server/src/ValRouter.ts`                                                                                                            |
| RSC                       | `packages/next/src/rsc/initValRsc.ts`                                                                                                         |
| Client                    | `packages/next/src/ValNextProvider.tsx`, `ValOverlayContext.tsx`, `client/initValClient.ts`                                                   |
| Template / example / docs | `packages/init/src/templates.ts`, `examples/next/val.config.ts`, `packages/next/README.md`                                                    |

---

## Risks and how they are handled

| Risk                                                            | Handling                                                                                                                                       |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Same commit deployed twice with different evaluated sources     | `baseSha` is part of the cache key and is sent to the cloud; commit sha alone is never treated as deploy identity                              |
| Deploy commit is not an ancestor of head (rollback, force-push) | Cloud returns an empty patch set + `x-val-live-degraded`; app renders deployed content                                                         |
| Cloud outage                                                    | stale-while-revalidate → stale-if-error → build-time content. Never throws, never 500s a page                                                  |
| Images from committed-but-undeployed patches                    | `patch_id` URLs via the already-unauthenticated `/files`; blocking retention requirement on the cloud                                          |
| A dynamic API sneaking into the live path                       | Live path must not touch `cookies()`/`headers()`/`draftMode()`; assert in review and in the example app's build output                         |
| Stega markers leaking to public HTML                            | `disabled` stays bound to draft mode only; covered by a unit test                                                                              |
| Patch fails to apply against older sources                      | `getSources` already records per-module errors and skips; live mode logs and falls back to the unpatched module rather than failing the render |

---

## Verification

Unit / type level (from repo root):

```bash
pnpm test                       # incl. new tests below
pnpm run -r typecheck
pnpm run lint && pnpm -w run format
```

New tests to write:

- `packages/server/src/LiveCache.test.ts` — fresh / stale-serve-and-refresh / expired-await /
  stale-if-error / `ttl: 0` bypass / concurrent-refresh dedupe. Inject a clock; do not use real
  timers.
- `packages/server/src/ValOps.test.ts` (or alongside `computeChangedPatchParentRefs.test.ts`) —
  `analyzePatches` with `includeApplied: true` includes `appliedAt` patches and the default still
  excludes them.
- `packages/next/src/client/useValStega.live.test.ts` — modelled on
  `useValStega.suspense.test.ts`: with `live` on and no draft mode, `getModule` is consulted;
  stega markers are absent; with `suspend` the component suspends until live sources land.
- `packages/shared` — round-trip the new `/live/sources` route through `createValClient`.

End-to-end against the example app:

1. Point `examples/next` at a real project (`project`, `VAL_API_KEY`, `VAL_SECRET`,
   `VAL_GIT_COMMIT`, `VAL_GIT_BRANCH`) with `live: { ttl: 0 }`.
2. `cd examples/next && pnpm run build && pnpm start` (build first, so the running deploy is
   pinned to a commit).
3. In a second checkout, edit content in the Val studio and **Save** (commits without redeploying).
4. Reload the running app **logged out, in a fresh incognito window** — the committed change must
   appear. Set `ttl: 60` and confirm it takes up to 60s, and that `staleWhileRevalidate` serves
   instantly while refreshing.
5. Add a new blog route via a committed patch and hard-load its URL — it must render, not 404.
6. Add an image in a committed patch and confirm it loads (this is the cloud retention requirement
   in practice).
7. Kill network access to `content.val.build` (block it in `/etc/hosts`) and confirm the app keeps
   serving — stale first, then build-time content — with a warning in the log and no 500.
8. Confirm no `data-val-path` stega attributes in the anonymous HTML (`curl … | grep val-path`).

CLI regression (required whenever `packages/server` changes, per repo rules):

```bash
cd packages/cli && pnpm exec tsx src/cli.ts validate --root ../../examples/next
```

Full CI parity before declaring done: `pnpm run build` (then `pnpm preconstruct dev`) and
`cd examples/next && pnpm run build`.

---

## Sequencing

1. **This document.** Agree the shape before any code lands.
2. Hand Part 1 to the content.val.build repo. Nothing here ships until `/live/patches` exists.
3. Config surface + validation (2.1) — small, self-contained, unblocks everything else.
4. `LiveCache` + `fetchLivePatches` + `getLiveSources` (2.2) with unit tests, against a stubbed
   endpoint.
5. `/live/sources` app endpoint (2.3).
6. RSC path (2.4) — the highest-value surface, shippable on its own.
7. Client hooks + suspend integration (2.5).
8. Editor consistency (2.6), docs, example, changeset.

## Out of scope

Push/websocket invalidation (the cloud already has a websocket channel for the studio; wiring it to
public rendering is a follow-up that would let `ttl` be effectively infinite). Live mode for the
pages router. Per-module or per-route TTLs. Any change to how patches are created or committed.
