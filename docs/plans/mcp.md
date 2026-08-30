# MCP support for Val — implementation plan

> **How to use this document.** It is written to be self-contained: paste it into
> a fresh session that has `valbuild/val`, `valbuild/template-nextjs-starter` and
> `valbuild/home` attached. Nothing here assumes context from the session that
> produced it.
>
> Every claim about `valbuild/val` and `valbuild/template-nextjs-starter` was
> verified against the code on 2026-08-30 and carries a `file:line`. Claims about
> the MCP spec and npm packages were verified the same day against the raw
> published sources. **This revision also verified `valbuild/home`** (the repo
> the first draft could not read): Part D is no longer requirements-plus-questions
> but a design checked against the real backend, and the former open questions
> are answered inline with `file:line` evidence. Paths prefixed `home/` are in
> `valbuild/home`; unprefixed paths are in `valbuild/val`.

---

## Goal

Make Val content editable from any MCP client (Claude Code, Cursor, custom
agents), with **Val exposing the tools and the auth** and **the template defining
the actual MCP server**, so other MCP hosts can consume the same tools.

Authentication ships as **personal access tokens** (Stage 2), reusing the
`val login` device flow Val already has, with **OAuth 2.1** (Stage 3) as the
documented destination. The Stage 2 design is **PAT pass-through**: the MCP
route forwards the caller's PAT to content.val.build as the credential for
every backend call, so the backend — not the app — authenticates the user.
Local development needs no credential at all.

**Reading `valbuild/home` changed the plan in two ways.** First, the backend
already accepts a PAT as a first-class credential on every content endpoint
(`home/content/src/utils/auth.ts:40-52`), and `ValOpsHttp` already knows how to
send one (`ValOpsHttp.ts:174-206`) — so Stage 2 no longer needs the app to
verify tokens and assert identity on the backend's behalf; it can pass the PAT
through and let the backend enforce it. Second, the audit surfaced concrete
weaknesses in the existing auth machinery (Part D.4 and D.7) that must be fixed
**before** PATs become the advertised credential for agents: today a PAT is
stored in plaintext, never expires, cannot be listed or revoked by its owner,
and is issued by a login flow with no consent step. Shipping MCP multiplies the
number of PATs in circulation; the fixes come first.

---

## Background: there is nothing to re-expose

The load-bearing discovery, and the reason this is a build rather than a wiring
job:

> **All 18 chat tools are defined _and executed in the browser._**
> `packages/ui/spa/hooks/useAI.ts` holds the definitions (`ALL_TOOLS`, lines
> 80–597) and the executor (one if/else chain, 917–2090), which reads the
> Studio's client stores. The LLM is Val-hosted: the browser calls
> `POST /ai/initialize` for a nonce, opens a WebSocket **straight to
> content.val.build**, and ships the system prompt + tool schemas on _every_
> prompt (`useAI.ts:2250-2341`). Val's backend stores none of them.
> `packages/server` contains **no tool executor at all**.

So MCP support means building Val's first server-side tool executor. The MCP
transport on top is thin.

### What ports

Verified tool by tool against `ValOps`:

| Verdict                              | Tools                                                                                                                                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Portable** (ValOps-backed or pure) | `get_all_schema`, `get_source`, `validate_content`, `get_patches`, `get_source_path_from_route`, `count_entries`, `get_record_keys`, `duplicate_source`, `empty_at_path`, `remove_image_gallery_entry`, `create_patch` |
| **Needs new infra**                  | `search_content` — the index is a FlexSearch instance in the Studio's _worker realm_ (`spa/stores/SearchStore.ts`)                                                                                                     |
| **Studio-only**                      | `navigate_to`, `show_compare_view`, `ask_user_question`, `get_current_context`                                                                                                                                         |

`search_content` is deferred but not hard: `packages/ui/spa/search/searchIndex.ts`
is 216 React/DOM-free lines over `flexsearch`. The unsolved part is index
lifecycle server-side (build cost, invalidation keyed on `sourcesSha`), not the
algorithm.

---

## Architecture

```
ValOps  (ValOpsFS | ValOpsHttp)                       ← data layer, exists
    ↓                                                   (ValOpsHttp authenticates
@valbuild/server/tools        ← NEW. Transport-agnostic registry. No MCP SDK.     per request with the
  createValTools(...) → { list(), listJsonSchema(), call(name, args, ctx) }       caller's PAT — Part D.2)
    ↓
 ┌──────────────────────┬──────────────────────┬─────────────────────────┐
 │ template             │ examples/next        │ anyone else             │
 │ mcp-handler@2        │ same (CI coverage)   │ stdio / Express / Hono  │
 │ src/app/api/mcp      │                      │ / Workers / raw SDK     │
 └──────────────────────┴──────────────────────┴─────────────────────────┘
```

**The registry must not import any MCP SDK.** That is what makes other MCP hosts
work, and it is not hypothetical hygiene: the TypeScript SDK split at v2.0.0
(2026-07-27) into `@modelcontextprotocol/{core,server,client}`, retiring the
monolithic `@modelcontextprotocol/sdk`. Coupling the registry to an SDK that
reorganises itself is how this rots.

---

## Part A — the tool registry

New: `packages/server/src/tools/`.

```ts
export type ValToolDefinition = {
  name: string;
  title?: string;
  description: string;
  /** zod v4 — a Standard Schema, which is what the MCP SDKs consume. */
  inputSchema: z.ZodType;
  annotations?: {
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
  };
};

export type ValToolContext = {
  /**
   * The caller's credential and identity, established per request by the host
   * (Part D.2). `null` only in local fs mode, where there is no credential
   * (Part D.1).
   */
  auth: { pat: string; profileId: ProfileId } | null;
  sessionId: string | null;
};

export type ValToolResult =
  | { status: "ok"; data: Json }
  | { status: "error"; code: ValToolErrorCode; message: string };

export type ValTools = {
  list(): ValToolDefinition[];
  /** Same tools with `inputSchema` as JSON Schema, for hosts wanting the wire shape. */
  listJsonSchema(): ValToolDefinitionJson[];
  call(
    name: string,
    args: unknown,
    ctx: ValToolContext,
  ): Promise<ValToolResult>;
  dispose(): Promise<void>;
};

export function createValTools(options: ValToolsOptions): ValTools;
```

Decisions:

- **zod v4 in, JSON Schema out.** Definitions carry zod schemas; `listJsonSchema()`
  derives the wire form via zod 4's built-in `z.toJSONSchema()`. Both
  `mcp-handler@2` and `@modelcontextprotocol/server@2` consume a Standard Schema,
  so SDK hosts use `list()` directly and nothing needs a JSON-Schema→zod
  converter. `@valbuild/server` already depends on `zod ^4.4.3`;
  `@modelcontextprotocol/server@2` requires `^4.2.0`. Compatible.
- **The result shape is deliberately not MCP's `CallToolResult`.** The adapter in
  the host maps `{status:"ok"}` → `{content:[{type:"text",text:JSON.stringify(data)}],
structuredContent: data}` and `{status:"error"}` → `{content:[…], isError:true}`.
  Errors stay in-band so the model can recover, per spec.
- **Tool names stay identical to the Studio's.** The definitions are separate for
  now (accepted duplication), but identical names make later convergence a move
  rather than a rename. MCP clients namespace by server, so no `val_` prefix.
- `ValToolsOptions` mirrors what `createValServer` takes (`valModules`, `config`,
  `mode`, `apiKey`, `project`, `gitCommit`, `gitBranch`, `root`, `formatter`).
  **Reuse** the mode resolution in `initHandlerOptions`
  (`packages/server/src/ValRouter.ts:148-231`) — extract it to its own module so
  the registry and `createValServer` share one copy rather than drifting.
- **`ctx.auth` is per-call, but `ValOpsHttp` fixes its credential at
  construction** (`ValOpsHttp.ts:174-206` — `authHeaders` is a `readonly` field
  set from the `auth: { apiKey } | { pat }` constructor arg). Two ways to thread
  the caller's PAT through, decide in implementation:
  1. Extend the `ValOpsHttp` methods the tools touch to take an optional
     per-request auth override (mechanical; the headers are spread into each
     `fetch` already, e.g. `saveSourceFilePatch` at `ValOpsHttp.ts:791-817`).
  2. Hold a small TTL-bounded cache of `ValOpsHttp` instances keyed by
     `sha256(pat)` inside the registry.

  Prefer (1): it keeps one instance and cannot leak per-user state between
  callers through instance-level caches. Whichever is chosen, **the app-level
  `VAL_API_KEY` must never be the credential for an MCP-originated call** — see
  D.6 for why.

### Shared helpers move to `@valbuild/shared/internal`

These are already React/DOM-free and must not be reimplemented:

- `packages/ui/spa/hooks/aiSourceToolPatches.ts` — `buildDuplicatePatch`,
  `buildEmptyAtPathPatch`, `describeContainerAtPath`
- `packages/ui/spa/hooks/aiImageToolPatches.ts` — `buildRemoveImageGalleryEntryPatch`,
  `resolveSerializedSchemaAtPath`, `getSourceAt`, `safeParsePatch`
- `packages/ui/spa/validation/blockingValidationErrors.ts` — `filterBlockingValidationErrors`
- `packages/ui/spa/utils/toolNames.ts`

**`@valbuild/shared/internal` is the correct home, not `packages/server`.**
Checked: `@valbuild/ui` exports only `.` and `./server`, so `packages/server`
cannot reach into `spa/**`. `@valbuild/shared` depends on nothing but
`@valbuild/core` and zod, the SPA already imports `@valbuild/shared/internal`
(e.g. `Patch` in `useAI.ts`), and `@valbuild/server` lists it as a dependency.
One copy, reachable from both realms, no dependency inversion.

`emptyOf` (`packages/ui/spa/components/fields/emptyOf.ts`) is React-free despite
its path but pulls `format` from `date-fns` for a single `yyyy-MM-dd` — inline
that rather than adding `date-fns` to `shared`.

**Land this move as its own commit** with the Studio's existing tests green
before building the registry on top, so any regression in the live chat path is
attributable.

---

## Part B — tools in this pass

| Tool                         | Implementation                                                  | Annotation        |
| ---------------------------- | --------------------------------------------------------------- | ----------------- |
| `get_all_schema`             | `ValOps.getSerializedSchemas()` (`ValOps.ts:704`)               | `readOnlyHint`    |
| `get_source`                 | `getSources` / `getSourcesWithPatchesApplied` (`:824`, `:1026`) | `readOnlyHint`    |
| `get_record_keys`            | pure over schema + source                                       | `readOnlyHint`    |
| `count_entries`              | pure (`describeContainerAtPath`)                                | `readOnlyHint`    |
| `validate_content`           | `validateSources` (`:1038`) + blocking filter                   | `readOnlyHint`    |
| `get_patches`                | `fetchPatches` (`:2133`); drop client-only `isPending`          | `readOnlyHint`    |
| `get_source_path_from_route` | `getSourcePathFromRoute`, already in `@valbuild/core`           | `readOnlyHint`    |
| `create_patch`               | see Part C — **text/JSON values only**                          |                   |
| `duplicate_source`           | `buildDuplicatePatch` + Part C                                  |                   |
| `empty_at_path`              | `buildEmptyAtPathPatch` + Part C                                |                   |
| `remove_image_gallery_entry` | `buildRemoveImageGalleryEntryPatch` + Part C                    | `destructiveHint` |

Deferred, each with a reason:

- **`search_content`** — needs a server-side index lifecycle (above).
- **`add_session_image_to_gallery`, and image values in `create_patch`** — session
  images are a _chat_ concept: the bytes live in Val's AI session store keyed by
  an opaque handle the browser received from the vision system. MCP has no
  equivalent, so this needs a different affordance (a local file path, or inline
  base64). Note this is also the only fs-mode path that touches a PAT — see
  Part D.1.
- **`navigate_to`, `show_compare_view`, `get_current_context`** — require a live
  Studio (`useNavigation`, `window.location`).
- **`ask_user_question`** — maps naturally onto the 2026-07-28 spec's
  `resultType: "input_required"` multi-round-trip flow when we want it.

---

## Part C — the write path

Three things the Studio does client-side have no server equivalent:

1. **Patch id.** The Studio calls `patchStore.mintPatchId()`. Server-side, mint a
   `PatchId` directly (same format).

2. **`parentRef`.** The Studio reads `patchSync.currentParentRef()`. Derive it:
   `fetchPatches()` → last patch id → `{type:"patch", patchId}`, else
   `{type:"head", headBaseSha: await getBaseSha()}`.
   Note the asymmetry: **`ValOpsFS` ignores `parentRef` entirely**
   (`ValOpsFS.ts:816`, `:905` — the append-only ordering log defines order; see
   `architecture/patch-store.md`), while `ValOpsHttp` sends it as `parentPatchId`
   for optimistic concurrency (`ValOpsHttp.ts:812`).
   `createPatch` can return `patch-head-conflict` — re-derive and retry **once**,
   then surface the conflict as a tool error rather than looping.

3. **Speculative validation.** The Studio runs `system.host.validateSpeculative`,
   which executes the user's own `validate` closures — these are _not_ carried by
   the serialized schema. Server-side the equivalent is available and strictly
   better, because `ValOps.getSchemas()` returns real `Schema` instances. So:
   apply the patch to a **copy** of the sources with `applyPatch`/`JSONOps`, run
   `validateSources`, then `filterBlockingValidationErrors`, and reject the write
   if anything blocking remains. Nothing reaches the store on rejection.

Signature for reference:
`ValOps.createPatch(path, patch, patchId, parentRef, sessionId, authorId)`
(`ValOps.ts:2080`).

---

## Part D — authorization

Two stages. **Stage 2 is the shipping target**; Stage 3 is the destination and is
kept here so Stage 2 is not built in a way that forecloses it. Between them sits
D.4 — the auth fixes in `valbuild/home` and `packages/server` that gate Stage 2:
MCP makes PATs a first-class, widely-distributed credential, and the machinery
that mints and checks them is not currently safe enough for that.

### D.0 The trust model as it stands today (verified against `valbuild/home`)

content.val.build authenticates every request in one place —
`authById` (`home/content/src/utils/auth.ts:13-58`) — which accepts, in order:

1. **The project API key** (`Authorization: Bearer <VAL_API_KEY>`, compared
   with `===` at `:23`). The end-user identity is then taken **verbatim** from
   the `x-val-profile-id` header (`:24-27`) — the app asserts who the user is,
   and the backend believes it.
2. **A presigned auth nonce** (`x-val-auth-nonce`, `:30-39`) — minted for the
   Studio's browser-direct calls; resolves to a stored `profile_id`.
3. **A personal access token** (`x-val-pat`, `:40-52`) — resolved to a
   `profile_id` by table lookup, then checked for **org membership** of the
   project's org (`orgs.getOrgMember`; the `member_role` it returns is fetched
   and ignored — no role enforcement).

Two consequences the first draft could not see:

- **The "app asserts identity" weakness is real but path-dependent.** It exists
  only on the API-key path. On the PAT path **the backend itself is the
  authority on identity** — which is exactly the property MCP auth should have,
  and it already exists end to end: `ValOpsHttp` can be constructed with
  `auth: { pat }` and sends `x-val-pat` on every call (`ValOpsHttp.ts:174-206`),
  as `getSettings`, `uploadRemoteFile` and `getPresignedAuthNonce` already do.
- **But identity is only authenticated, not bound to writes.** `postPatches`
  authenticates the request, then records whatever `authorId` the JSON body
  claims — the authenticated `profileId` from `authById` is unwrapped and never
  compared (`home/content/src/handlers/postPatches.ts:80-82`, `:115`). So even a
  PAT-authenticated caller can attribute a patch to any other user. D.3 fixes
  this.

For reference, the Studio's cookie is how the _app_ decides which `authorId` to
assert on the API-key path: `ValServer` reads `auth.id` off the verified
`val_session` cookie and forwards it (`ValServer.ts:3076-3094` —
`getProfileAuthHeaders`).

### D.1 Local (`fs`) mode: no credential at all

**Local MCP needs no PAT and no `val login`.** This is not an assumption — it
falls out of the tool set:

- `getAuth` is bypassed unconditionally in fs mode: every failure branch returns
  anonymous `{error: null, id: null}` when `serverOps instanceof ValOpsFS`
  (`ValServer.ts:217-277`).
- `validateRemoteFiles` is a **stub** — `// TODO: Implement`, returns `{}`
  (`ValOps.ts:1236-1243`), so validation never goes to the network.
- The PAT in `ValOpsFS` is used **only** by `getPresignedAuthNonce`
  (`ValOpsFS.ts:119-147`), the remote-file upload flow.

Every stage-1 tool operates on local content and touches none of that. Patches
land in `.val/patches` with `authorId: null`, as the Studio does locally. The
only fs-mode paths that reach for a PAT are remote file uploads — precisely the
image/session-key group deferred in Part B. The boundary lines up.

**Guard rails, non-negotiable:**

1. **Refuse to serve unauthenticated in production.** Decide by _Val mode_, not
   `NODE_ENV` alone: in `http` (proxy) mode a bearer PAT is required always; in
   `fs` mode the route must refuse to serve when `NODE_ENV === "production"`.
   Without that line a deployed template is an open content-write endpoint.
2. **Validate `Origin`/`Host` on the fs-mode route.** An unauthenticated local
   HTTP endpoint is the textbook DNS-rebinding target, and the MCP spec requires
   origin validation for locally-served HTTP transports. CORS preflight blocks
   naïve cross-origin JSON-RPC POSTs, but rebinding bypasses origin checks
   entirely unless the server verifies `Host`. The SDK ships
   `hostHeaderValidationResponse` / `originValidationResponse` guards (Part F) —
   use them (or equivalent checks) in the template route too, not only in
   non-`mcp-handler` hosts.

### D.2 Stage 2 — PAT pass-through (ship this)

Reuse the credential Val already issues, and let the backend enforce it.
`val login` is an existing browser-confirm device flow: `startValLogin` POSTs
`{host}/api/login` and returns a URL for the user to open;
`awaitValLoginConfirmation` polls `{host}/api/login?token=…&consume=true` and
returns `{ profile: { email }, pat }` (`login.ts:53-56`, `:110-172`);
`persistPersonalAccessToken` writes `.val/pat.json` at mode `0600`
(`login.ts:179-201`). Backend side, the consume mints the PAT and returns it
(`home/admin/src/app/api/login/route.ts:67-74`).

Flow:

```
developer: val login                       → .val/pat.json            (exists today)
MCP client ──Authorization: Bearer <pat>──▶ /api/mcp
                                             │ 1. verify once per request (cached):
                                             │    whoami(pat) → profileId    ← D.3
                                             │ 2. execute tools with the PAT as the
                                             ▼    backend credential:
                                           registry → ValOpsHttp(auth: {pat})
                                                        │  x-val-pat: <pat>
                                                        ▼
                                           content.val.build authById → PAT branch
                                           (profile lookup + org membership, :40-52)
```

Why pass-through rather than the app verifying the PAT and then asserting
`authorId` under its own `VAL_API_KEY` (the first draft's design — rejected in
D.6):

- **The backend is the enforcement point on every call**, not just at the front
  door. Org membership is re-checked per request; a revoked PAT stops working
  server-side immediately (the front-door cache adds at most its TTL).
- **The MCP route stops being a confused deputy.** It holds no authority of its
  own for MCP traffic; a bug in the route's verification cannot escalate to
  "writes as anyone" because the API key is never the credential for
  MCP-originated calls.
- **It is less code.** `ValOpsHttp` already speaks PAT; no verify-then-assert
  bridge to build.

The route-level verification (step 1) still exists, for three reasons: to reject
garbage before any tool runs, to satisfy `withMcpAuth`'s `verifyToken` contract
with a 401 challenge, and to learn the caller's `profileId` for `authorId` and
`ctx.auth`. **Cache resolutions keyed by `sha256(pat)` — never the raw PAT —
with a TTL ≤ 60 seconds**: long enough to keep serverless latency sane, short
enough that revocation (D.4.2) means something. Cache negative results briefly
(a few seconds) so a bad token cannot turn the route into a backend
amplification vector, and never log the token.

Handling rules for the PAT inside the route: accept it from the
`Authorization: Bearer` header only (never a query parameter — those end up in
access logs), and pass it to the registry via `ctx.auth`, not via any structure
that gets serialized into logs, traces, or MCP results.

**What Stage 2 needs that does not exist: one small endpoint (D.3) and the
lifecycle fixes (D.4).** The resolution _mechanism_ exists —
`personalAccessTokens.getProfileIdByToken`
(`home/server-side/src/db/dal/personalAccessTokens.ts:33-43`) is exactly the
lookup, and `authById` already runs it per request — but no endpoint returns
the resolved identity to the caller: `getSettings` responds with only
`{publicProjectId, remoteFileBuckets}` (`home/content/src/handlers/getSettings.ts`,
mirrored by the client schema in `getSettings.ts:6-9`).

### D.3 The backend additions (small, and now precisely known)

Both changes are in `valbuild/home`, both are a handful of lines, and both
should land in one PR:

1. **Expose the authenticated principal.** Either add
   `profile: { profileId, role }` to the `/settings` response (the handler
   already has `profileId` in scope from `authById` — it just drops it), or add
   `GET /v1/:org/:project/whoami` returning the same. Prefer extending
   `/settings`: `ValServer` and the CLI already call it with PAT auth
   (`getSettings.ts:26-36`), so the client plumbing exists. The response field
   must be derived from the **authenticated** principal (the `profileId` that
   `authById` returned), never from a header.
2. **Bind `authorId` to the authenticated principal.** In `postPatches` (and any
   other write handler that records an author): when `authById` resolved a
   `profileId` from a PAT or nonce, **ignore the body's `authorId` and use the
   resolved one** (`home/content/src/handlers/postPatches.ts:115` is the write).
   Keep the current behaviour only for the API-key path, which has no
   authenticated user to bind to — that asymmetry is the D.9 follow-on. This
   closes the attribution-spoofing hole in D.0 for every PAT caller, the MCP
   route included, and costs one conditional.

Val exports the verifier (`verifyValPat` in `@valbuild/server`, a thin cached
wrapper over the extended `/settings`); the template calls it from
`withMcpAuth`'s `verifyToken`.

### D.4 Fix auth first: the Stage 2 gate (all in `valbuild/home`)

These are pre-existing weaknesses, but MCP is what turns them from dormant to
load-bearing: it multiplies how many PATs exist, how long they live in plaintext
MCP client configs on disk, and how attractive stealing one is. **1–3 block the
Stage 2 release**; 4 should ride along.

1. **PATs are stored in plaintext.** The `pat` column _is_ the secret —
   `DEFAULT encode(gen_random_bytes(32), 'hex')`
   (`home/db/migrations/1736172418.do.use_pat_sha_hex.sql`; the migration names
   say "sha" but no hashing happens), and lookup is a plain equality
   (`personalAccessTokens.ts:33-43`). A database leak is a leak of every live
   credential. Fix: store `sha256(pat)`, look up by hash (also removes the
   timing side-channel of string-equality lookups), return the raw token once
   at mint. Migration must invalidate existing rows (the earlier PAT migrations
   already set that precedent with `DELETE FROM personal_access_tokens`).
2. **PATs cannot be listed or revoked by their owner, and never expire.** The
   DAL has `delete(profileId, uuid)` and `insert` returns the `uuid` handle —
   but **nothing calls them**: no endpoint, no UI, not even a `list` method
   (verified: the only callers in the repo are `authById`'s lookup and the login
   route's `insert`). D.5 rejects the session cookie _because_ PATs are
   separately revocable — that must actually become true. Fix: `list` DAO +
   listing/revoke endpoints + a "Personal access tokens" section on the admin
   settings page showing `created_at` (add `last_used_at` while at it), plus an
   expiry column checked in `getProfileIdByToken` (proposal: default 90 days,
   decide product-side; `val login` re-issues cheaply).
3. **The device flow has no consent step, and the URL is the whole secret.**
   `cli-login/page.tsx:37-56` links the nonce to the visitor's account **on GET
   render** — no "Approve" button. And the nonce in the user-visible URL is the
   _same_ token the CLI polls with, so whoever knows the URL can consume the
   PAT. Combined: send a logged-in victim a `val login` URL you generated, and
   their click (or their browser prefetching the link) hands you a PAT for
   their account — zero further interaction. The 50-per-IP/6-minute rate limit
   (`api/login/route.ts:78-88`) does not mitigate this. Fix, minimum: linking
   happens only on an explicit POST from an "Approve this CLI login" button
   (also removes the mutating GET). Better, cheap: split the token into a
   `device_code` (kept by the CLI, used to poll+consume) and a `user_code`
   (in the URL, shown for comparison), per RFC 8628's shape — a small
   `login_nonces` schema change.
4. **Constant-time comparisons.** The API-key check is `===`
   (`home/content/src/utils/auth.ts:23`). Compare digests with
   `crypto.timingSafeEqual` (hashing per fix 1 covers the PAT lookup).

### D.5 Why not the session cookie

The obvious cheaper move is to accept the `val_session` JWT as a bearer token: it
is verifiable locally with `VAL_SECRET` (HMAC), and its `sub` is already the
author id, so it needs **no backend work at all**. Rejected, for three reasons:

1. **It conflates two lifecycles.** The session cookie is the human's Studio
   login. Reusing it as an agent credential means you cannot revoke the agent
   without logging the person out, or rotate a leaked agent token without
   invalidating browser sessions. A PAT is separately revocable — once D.4.2
   lands.
2. **The JWT embeds a second, higher-value credential.**
   `IntegratedServerJwtPayload` (`ValServer.ts:2999-3005`) carries `token` — the
   admin.val.build-issued JWT, which the app uses as a **Bearer credential
   against admin.val.build** (`ValServer.ts:676-691`), minted with a 4-day exp
   (`home/admin/src/app/api/val/auth/token/route.ts:60-80`). MCP client configs
   are plaintext files on disk and are routinely committed by accident. A PAT is
   purpose-scoped; a session JWT is not.
3. **The UX is "copy it out of devtools."** `val login` already exists and is
   strictly better.

It would also require the D.8 fix first: `decodeJwt` never checks `exp`, so a
pasted session token is accepted by the server **forever**, not merely for the
cookie's client-side lifetime.

### D.6 Why not verify-then-assert (the first draft's Stage 2 — rejected)

The first draft had the route resolve the PAT to a `profileId`, then execute
tools through the app's existing `ValOpsHttp(auth: { apiKey })`, asserting the
resolved id via `x-val-profile-id`/`authorId`. Now that the backend is readable,
pass-through (D.2) dominates it on every axis:

- Verify-then-assert makes the MCP route a **confused deputy**: the API key is
  all-powerful (`authById` accepts any asserted profile id with it, and — D.0 —
  the backend does not even check the asserted id is a member of anything), so
  the route's token check is the only thing between a forged request and
  arbitrary-author writes. With pass-through, a broken route check yields
  requests the backend rejects.
- Revocation under verify-then-assert is only as fresh as the route's cache;
  under pass-through the backend re-checks the PAT on every call.
- Verify-then-assert needs the same D.3 endpoint _plus_ identity-assertion
  plumbing; pass-through needs the endpoint alone. The only cost of
  pass-through is threading per-request auth into `ValOpsHttp` (Part A).

### D.7 Stage 3 — OAuth 2.1 (the destination)

Stage 2 is deliberately a stepping stone, not a detour: the extended `/settings`
(D.3) becomes token introspection, the PAT becomes an access token, and
`val login` becomes the authorization flow.

Roles: the Next app's `/api/mcp` is the **Resource Server**; admin.val.build is
the **Authorization Server**; the resource identifier is the endpoint URL.

Resource-server obligations (MCP authorization spec, revision 2026-07-28):

- **RFC 9728 Protected Resource Metadata** at
  `/.well-known/oauth-protected-resource` (`MUST`; clients `MUST` use it for AS
  discovery).
- **401 + `WWW-Authenticate`**, `SHOULD` include `scope`:
  `Bearer resource_metadata="…", scope="val:read val:write"`.
- **Token validation**: signature, `iss`, `exp`, and **audience per RFC 8707** —
  `aud` must match this resource. Audience binding is what stops a token minted
  for one Val site being replayed against another. Note this is a property
  **Stage 2 does not have**: a PAT is account-wide (below), so a PAT leaked from
  one deployment works against every project the owner can reach. Accept that
  knowingly.
- **403 on insufficient scope.**

`mcp-handler` supplies all of it: `withMcpAuth(handler, verifyToken, {required,
requiredScopes, resourceMetadataPath})`, plus `protectedResourceHandler` and
`metadataCorsOptionsRequestHandler`.

Authorization-server requirements, **now checked against `valbuild/home`** —
the first draft hoped the existing `/authorize` → `consumeCode` flow was "a
promising starting point"; having read it, it is not. It is an internal
code-relay for the Studio, and it must be treated as **replace, not extend**:

- `home/admin/src/app/authorize/page.tsx:74-97` mints an auth code for the
  logged-in visitor and redirects **with no consent screen, no `client_id`, no
  PKCE, and no validation of `redirect_uri`** (`:43-50` checks only that it is a
  string) — an open redirect that hands a fresh, profile-bound code to any URL
  in the link. What contains the damage today is the token endpoint
  (`home/admin/src/app/api/val/auth/token/route.ts:29-53`): exchanging a code
  requires a project API key whose org the victim belongs to
  (`home/server-side/src/db/dal/authCodes.ts:31-52`). That is a real but thin
  wall — any leaked API key of any project in the victim's org crosses it.
- Codes are single-use (consume deletes) but **never expire**: `created_at`
  exists and is never checked, and there is no cleanup — an unconsumed code is
  valid indefinitely.
- **Near-term hardening, independent of Stage 3** (small, in `valbuild/home`):
  add a consent click, an exact-match `redirect_uri` allowlist per project, and
  a ~10-minute expiry check in `consumeAuthCode`. Do this even if Stage 3 is
  far off — the Studio login uses this flow today.

What the AS must provide (all new build — there is **no JWKS or asymmetric-key
infrastructure anywhere in `valbuild/home`**; both existing JWTs are HS256 with
shared secrets, `VAL_APP_SECRET` admin-side and `VAL_SECRET` app-side):

- **RFC 8414 metadata** at `/.well-known/oauth-authorization-server`.
- **OAuth 2.1**: authorization code with **PKCE `S256` mandatory**.
- **RFC 8707**: honour `resource` on authorization and token requests; set `aud`.
- **RFC 9207**: return `iss` in the authorization response. New in this revision.
- **Client registration**: current ordering is **Client ID Metadata Documents
  (CIMD) preferred → pre-registration → Dynamic Client Registration, which is
  deprecated**. DCR was the usual answer for MCP and is now the fallback.
- **Scopes**: at least `val:read` / `val:write`. The permission model has
  something to hang these on — org membership already carries a role
  (`owner`/`developer`/`editor`, `home/server-side/src/db/dal/orgs.ts:41-53`) —
  but **nothing on the content API enforces roles today** (`authById` fetches
  `member_role` and ignores it), so scope enforcement is new code either way.
  Finer granularity is much harder to add later than now.
- **JWKS endpoint** — prefer JWT access tokens validated against JWKS over RFC
  7662 introspection, so the serverless route needs no per-request round trip.
- **Consent screen** naming the resource (the flow above shows the AS currently
  has no consent surface at all — budget for building one, it is also D.4.3's
  fix).

Given all of it is new build, seriously evaluate adopting a maintained OAuth
provider library (or delegating the AS entirely) rather than hand-rolling —
the hand-rolled HS256 layer already produced D.8.

**What Stage 2 does not give you, and only Stage 3 will:** third-party clients
that expect OAuth discovery (Claude Desktop's connector UI is OAuth-oriented),
scoped least privilege, and per-resource audience binding.

### D.8 Prerequisite fix in `packages/server`, separate PR

`decodeJwt` (`packages/server/src/jwt.ts:11-66`) has three problems:

1. It parses the payload and returns it **without ever checking `exp`**. Expiry
   is enforced only by the cookie's client-side `expires` attribute
   (`ValServer.ts:639` says so in as many words), so a leaked or copied
   `val_session` token is accepted by the server indefinitely. Note the zod
   check in `withAuth` (`ValServer.ts:3043`) only verifies `exp` _is a number_,
   not that it is in the future.
2. The signature comparison at `:52` is a plain `!==` rather than
   `crypto.timingSafeEqual`.
3. `secretKey` is **optional**, and omitting it skips signature verification
   entirely. The one legitimate unverified call (`consumeCode` decoding the
   token it just received from admin.val.build over TLS, `ValServer.ts:198`)
   should be an explicitly-named `decodeJwtUnverified` so the default path
   cannot silently skip verification.

Pre-existing, and it affects the Studio's cookie path regardless of which stage
you pick. **Fix it in its own PR** — changing `decodeJwt` changes login
behaviour and must not ride inside an MCP change.

### D.9 Follow-on worth designing toward

The end state D.5 of the first draft hoped for — content.val.build accepting the
**user's** credential directly and deriving the author itself — is **already
half-real**: the PAT path does exactly that, and D.3.2 completes it by binding
`authorId` server-side. What remains is retiring the API-key-plus-asserted-
identity path for the Studio: once Val's AS issues user tokens (Stage 3), the
Studio's server can forward those instead of asserting `x-val-profile-id` under
`VAL_API_KEY`, and the API key shrinks to app-level concerns (deploy hooks,
settings). Do not design the AS in a way that forecloses this — allow
content.val.build to be a second registered resource.

---

## Part E — template wiring

Verified npm state (2026-08-30): `mcp-handler@2.1.1`, peer
`@modelcontextprotocol/server@^2.0.0` and `next >=13`. The `[transport]` catch-all
and the Redis requirement are **gone** in 2.x — a plain `route.ts` exporting
`GET`/`POST` is the whole thing. The 2026-07-28 protocol revision is stateless: no
`initialize`, no `Mcp-Session-Id`.

New files in `template-nextjs-starter`:

- **`src/val/val.tools.ts`** — `"server-only"`; `createValTools(valModules, {...config})`,
  mirroring the existing `src/val/val.server.ts`.
- **`src/app/api/mcp/route.ts`** — **outside both route groups**. Route handlers
  never render a layout, so the `(main)`/`(val)` split (which exists because each
  group owns its own root layout) does not apply; a top-level `api/` keeps MCP
  independent of both. Needs `export const runtime = "nodejs"` and
  `export const dynamic = "force-dynamic"`.

  ```ts
  // Mode-aware guard (D.1): in proxy mode a PAT is always required; in fs
  // mode serve unauthenticated ONLY outside production.
  const isProxyMode = valMode === "http";
  if (!isProxyMode && process.env.NODE_ENV === "production") {
    // export handlers that always return 404/503 — never an open write endpoint
  }

  const handler = createMcpHandler((server) => {
    for (const tool of valTools.list()) {
      server.registerTool(
        tool.name,
        {
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
        },
        async (args, ctx) =>
          toCallToolResult(
            await valTools.call(tool.name, args, {
              // Pass-through (D.2): the caller's PAT is the backend credential
              // for every ValOps call this request makes. authInfo.token is the
              // verified bearer token; extra.profileId came from verifyValPat.
              auth: ctx.http?.authInfo
                ? {
                    pat: ctx.http.authInfo.token,
                    profileId: ctx.http.authInfo.extra.profileId,
                  }
                : null,
              sessionId: null,
            }),
          ),
      );
    }
  });

  // Stage 2: `verifyValPat` (from @valbuild/server) resolves the bearer PAT to
  // a Val profile via the extended /settings (D.3), cached by sha256(pat) with
  // a ≤60s TTL. It must never log the token.
  // Stage 3 swaps this for access-token validation and adds `requiredScopes`
  // plus `resourceMetadataPath` — the surrounding wiring does not change.
  const authHandler = withMcpAuth(handler, verifyValPat, {
    required: isProxyMode,
  });
  export { authHandler as GET, authHandler as POST };
  ```

  In fs mode, additionally validate `Origin`/`Host` (D.1 guard rail 2).

- **`src/app/.well-known/oauth-protected-resource/route.ts`** — **Stage 3 only.**
  `protectedResourceHandler({ authServerUrls: ["https://admin.val.build"] })`
  plus `metadataCorsOptionsRequestHandler()` as `OPTIONS`. Not needed for
  Stage 2; listed here so the route's eventual home is settled.
- **`.env.example` + README** — the Val project vars, and how to attach the server:
  `claude mcp add --transport http val https://site.com/api/mcp --header "Authorization: Bearer $VAL_PAT"`.
  The README must say plainly what a PAT is worth (Risks 5): it grants
  everything its owner can touch, across **every project of every org they
  belong to** — treat it like a password, prefer per-agent PATs once the D.4.2
  UI exists, and revoke on any suspicion. Note the header is right for Stage 2
  but **wrong for Stage 3**: once the server advertises OAuth, a rejected
  `Authorization` header is reported as a failure rather than falling through
  to the OAuth flow, so the header must be dropped when Stage 3 lands. Document
  that in the README rather than discovering it.

`package.json`: add `mcp-handler@^2`, `@modelcontextprotocol/server@^2`, `zod@^4`,
and `"engines": { "node": ">=20" }` (both packages require it; the template
currently declares none). `tsconfig.json` needs `"types": ["node"]` — TypeScript
≥6 no longer auto-includes `@types/*` and the SDK's `.d.mts` references `Buffer`.

**Also add the same route to `examples/next`.** The template is not in Val's CI;
`examples/next` is, and its `pnpm run build` is the job that catches the
duplicate-`@types/react` class of failure. Without this the MCP path ships
untested.

---

## Part F — other MCP hosts

The registry is plain TypeScript over `ValOps` with zod schemas, so:

- **stdio** — mirror `packages/cli/src/lsp.ts` (a 5-line dynamic import that
  launches `@valbuild/language-server`) with a `val mcp --stdio` command over
  `@modelcontextprotocol/server/stdio`. Per spec, stdio implementations
  `SHOULD NOT` do OAuth and should read credentials from the environment — and in
  fs mode there is no credential to read (D.1). This is the natural path for
  pointing a local editor at a checkout.
- **Express / Fastify / Hono / Node** — first-party adapters exist
  (`@modelcontextprotocol/express` etc.).
- **Workers / any fetch runtime** — `createMcpHandler(...).fetch` is a
  web-standard `(Request) => Promise<Response>`. Note the SDK does **not**
  validate `Host`/`Origin`; use its `hostHeaderValidationResponse` /
  `originValidationResponse` guards when not behind `mcp-handler` — and in the
  fs-mode template route regardless (D.1).

---

## Order of work

1. **Auth fixes in `valbuild/home`** (D.4.1–D.4.4): hash PATs at rest, PAT
   listing/revocation UI + expiry, consent step in the CLI login, constant-time
   compares. Plus the near-term `/authorize` hardening from D.7 (consent,
   `redirect_uri` allowlist, code expiry). These gate the Stage 2 _release_,
   not the Stage 2 _build_ — start them in parallel with 2–6.
2. Move shared helpers to `@valbuild/shared/internal` — separate commit, Studio
   tests green.
3. Registry skeleton + read-only tools + unit tests.
4. Write path (Part C) + write tools + tests.
5. `examples/next` MCP route; exercise locally with **no auth at all** (D.1),
   including the production-refusal guard and Origin/Host validation.

   → **Steps 2–5 are the natural first PR**: a working local MCP server with no
   backend dependency whatsoever.

6. Backend additions in `valbuild/home` (D.3): expose the authenticated
   principal on `/settings`, bind `authorId` to the authenticated principal in
   write handlers. One small PR.
7. Per-request auth threading in `ValOpsHttp` (Part A) + `verifyValPat` in
   `@valbuild/server` (cached, hash-keyed), wired through `withMcpAuth` in the
   template.
8. Template wiring, README (including the PAT-blast-radius warning), changeset.
   **Ships here — gated on step 1 being live.**
9. `decodeJwt` fixes — separate PR (D.8). Independent of MCP; do it soon
   regardless: it is the Studio's session-expiry enforcement, and it becomes a
   hard prerequisite if anyone ever reconsiders D.5.
10. Stage 3 (D.7), when third-party OAuth clients or scoped access justify it.

---

## Verification

```bash
# fast loop
pnpm test packages/server/src/tools
pnpm run -r typecheck
```

Define fixtures type-safely with `s`/`c` from `initVal` per the repo's test rules;
`packages/server/test/example-projects/*` and `src/__fixtures__` are the existing
project fixtures. Never fix a failing test by editing the test.

End to end:

```bash
cd examples/next && pnpm run dev        # MCP at http://localhost:3456/api/mcp
npx @modelcontextprotocol/inspector      # list tools, call get_source
claude mcp add --transport http val http://localhost:3456/api/mcp
```

Then specifically: call `create_patch`, confirm the edit appears in the Studio at
`/val` **and** lands in `.val/patches` — a tool reporting success while saving
nothing is the exact failure mode `e2e/http/aiChat.spec.ts` was written for (read
its header comment). Then confirm a deliberately invalid patch is rejected by
speculative validation and writes nothing.

Auth-specific checks, all of them:

- **fs mode**: with `NODE_ENV=production` and no auth configured, the route
  serves nothing (guard rail D.1.1). A request with a wrong `Host`/`Origin` is
  rejected (D.1.2).
- **proxy mode**: no `Authorization` header → 401 with a `WWW-Authenticate`
  challenge; a garbage PAT → 401; a valid PAT → tools run and the created
  patch's author is the PAT owner's profile (checked in the Studio's patch
  list), **even when the request body claims a different `authorId`** (D.3.2).
- **Revocation**: revoke the PAT (D.4.2 UI or direct DB delete), confirm calls
  fail within the verify-cache TTL (≤60s).
- **No leakage**: grep route/server logs from the above runs for the raw PAT —
  it must appear nowhere.

For the OAuth path (Stage 3), verify the 401 challenge, the two metadata
documents, and that a token minted for a _different_ resource is rejected by
audience validation.

Full CI before calling it done:

```bash
pnpm run lint && pnpm -w run format && pnpm run -r typecheck && pnpm test
pnpm run build && pnpm preconstruct dev   # restore source entries after build
cd examples/next && pnpm run build        # separate CI job
cd packages/cli && pnpm exec tsx src/cli.ts validate --root ../../examples/next
```

The last one is not optional: `validate` is one of the only callers of
`createService` → `loadValModules`, and `packages/server` is changing.

---

## Former open questions — answered against `valbuild/home` (2026-08-30)

1. **Can a PAT be resolved to a profile id?** Yes — the lookup exists and runs on
   every PAT-authenticated request
   (`home/content/src/utils/auth.ts:40-52` →
   `home/server-side/src/db/dal/personalAccessTokens.ts:33-43`), but no endpoint
   returns the resolved identity to the caller. Exposing it is the D.3.1
   change — a few lines in `getSettings`, whose handler already holds the
   `profileId`.
2. **Are PATs revocable per-token, with a listing UI?** In principle (DAL
   `delete` by `(profileId, uuid)`), in practice no: zero callers, no `list`
   method, no UI, no expiry, plaintext at rest. This is D.4.1–D.4.2, and it
   gates Stage 2 because D.5's rejection of the session cookie leans on PAT
   revocability.
3. **Does the content API validate `authorId`?** No — on the API-key path the
   asserted `x-val-profile-id` is trusted verbatim without even a membership
   check (`auth.ts:24-27`), and `postPatches` records the body's `authorId`
   without comparing it to the authenticated principal
   (`postPatches.ts:80-82`, `:115`). D.3.2 fixes the PAT/nonce paths; the
   API-key path is D.9.
4. **How far is `/authorize` → `consumeCode` from OAuth 2.1 + PKCE?** Far enough
   that Stage 3 should treat it as replace-not-extend: no consent, no client
   identity, no PKCE, unvalidated `redirect_uri`, non-expiring codes; the only
   real control is that exchange requires an org-adjacent API key. Details and
   near-term hardening in D.7.
5. **Token/JWKS infrastructure?** None. Both JWTs in the system are hand-rolled
   HS256 with shared secrets (`home/admin/.../auth/token/encodeJwt.ts`,
   `packages/server/src/jwt.ts`). A Stage 3 AS is new build; consider a
   maintained provider library.
6. **What scope granularity exists?** Org-level roles
   (`owner`/`developer`/`editor`) exist in the schema and are returned by
   `getOrgMember` — and ignored by the content API's auth (`auth.ts:47-51`).
   Scope/role enforcement on content endpoints is new code whichever stage adds
   it.
7. **Can content.val.build accept a user token directly (old D.5)?** It already
   does — the PAT path. That discovery is what turned Stage 2 into pass-through
   (D.2/D.6). The remaining gap is binding writes to the authenticated identity
   (D.3.2) and, eventually, retiring asserted identity for the Studio (D.9).

**Still open:**

8. Where is `GET {valBuildUrl}/api/val/{project}/auth/session` served? The
   Studio's proxy-mode `/session` calls it with the embedded admin token
   (`ValServer.ts:676-691`), but no matching route exists in `valbuild/home`'s
   admin app (only `api/val/auth/token` does). Possibly a legacy `app.val.build`
   deployment (the repo README notes that host "stopped being published").
   Worth answering before Stage 3 builds on any of this machinery.
9. Product decisions from D.4: default PAT expiry (90 days proposed), and
   whether `editor`-role members should hold PATs with full content-API power
   (today role is not enforced at all — see answer 6).

---

## Risks

1. **Stage 2's release gate is now people-work, not unknowns.** The backend
   dependency (D.3) shrank to a few verified lines, but the D.4 lifecycle fixes
   (hashing, revocation UI, consent) are real work in `valbuild/home` and gate
   the release. Steps 2–5 stay independent, so an unexpected delay there stalls
   shipping, not building.
2. **Two tool definition sets will drift** (Studio's and MCP's). Accepted for now;
   identical names keep convergence cheap.
3. **Concurrent writes** — MCP callers and Studio users share the patch chain.
   `patch-head-conflict` plus one retry is the plan; whether that suffices under a
   long agent run is untested.
4. **Moving helpers touches the live chat path** (`useAI.ts` imports). Hence the
   separate commit.
5. **Stage 2 has no audience binding, and a PAT is account-wide** — broader than
   the first draft assumed: `authById` accepts a PAT for any project whose org
   the owner belongs to, at any role, so one leaked PAT reaches every project of
   every org of its owner. Stage 3's RFC 8707 `aud` plus scopes is the fix; until
   then the README warning (Part E) and the D.4 lifecycle controls (expiry,
   revocation, hashing) are the mitigations. Accept knowingly.
6. **Claude Desktop's connector UI is OAuth-oriented**, so a static bearer header
   may not be configurable there — Stage 2 likely reaches it only via the
   `mcp-remote` stdio bridge. Claude Code and Cursor take the header directly.
   Test the three separately; they do not behave identically. If Claude Desktop
   is a hard requirement, that alone argues for going straight to Stage 3.
7. **Per-request auth threading in `ValOpsHttp` touches every proxy-mode call
   site.** The change is mechanical (Part A option 1) but wide; the mitigations
   are the existing `ValOpsHttp` tests plus the end-to-end auth checks in
   Verification. Instance-per-PAT (option 2) is the fallback if the threading
   turns out invasive — measure before choosing it for construction-cost
   reasons alone.
