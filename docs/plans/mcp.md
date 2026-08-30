# MCP support for Val — implementation plan

> **How to use this document.** It is written to be self-contained: paste it into
> a fresh session that has `valbuild/val` and `valbuild/template-nextjs-starter`
> attached. Nothing here assumes context from the session that produced it.
>
> Every claim about `valbuild/val` and `valbuild/template-nextjs-starter` was
> verified against the code on 2026-08-30 and carries a `file:line`. Claims about
> the MCP spec and npm packages were verified the same day against the raw
> published sources.
>
> Part D describes what the hosted backend (admin.val.build and
> content.val.build) has to provide. That side is not open source, so it is
> described by the behaviour Val's own client code already depends on rather than
> by its internals, and the specific backend work items are tracked privately —
> see D.4. Everything stated here about the backend's request protocol is
> observable from `packages/server` in this repository.

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

**Checking the design against the backend changed it in two ways.** First, the
content API already accepts a PAT as a first-class credential on every endpoint,
and `ValOpsHttp` already knows how to send one (`ValOpsHttp.ts:174-206`) — so
Stage 2 does not need the app to verify tokens and assert identity on the
backend's behalf. It can pass the PAT through and let the backend enforce it,
which is both safer and less code (D.2, D.6).

Second, a set of hardening items on the credential's own lifecycle gate the
release rather than the build (D.4). Shipping MCP multiplies how many PATs exist
and how long they sit in plaintext MCP client configs on disk, so the controls
around issuing, listing, expiring and revoking them need to be in place before
PATs become the advertised credential for agents.

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
D.4 — credential-lifecycle work that gates the Stage 2 _release_, because MCP
turns PATs into a first-class, widely-distributed credential.

### D.0 The trust model the client already works within

Everything here is visible from `packages/server` in this repository; it is the
protocol Val's own client speaks, not backend internals.

The content API accepts three credentials, and which one is used decides who is
the authority on the caller's identity:

1. **The project API key** (`Authorization: Bearer <VAL_API_KEY>`). This is an
   app-level credential fixed at construction (`ValOpsHttp.ts:200-205`). The
   end-user identity travels separately, as an `x-val-profile-id` header the app
   asserts (`ValServer.ts:3076-3094`, `getProfileAuthHeaders`) — so on this path
   **the app is the authority on identity**, and the backend takes its word.
2. **A presigned auth nonce** (`x-val-auth-nonce`) — minted for the Studio's
   browser-direct calls, so the browser can upload without holding a long-lived
   credential.
3. **A personal access token** (`x-val-pat`) — the credential `val login`
   issues. The backend resolves it to a profile itself and checks that profile's
   access to the project.

The third is the important one for MCP: on the PAT path **the backend is the
authority on identity**, which is exactly the property agent auth should have.
And it already works end to end — `ValOpsHttp` can be constructed with
`auth: { pat }` and then sends `x-val-pat` on every call
(`ValOpsHttp.ts:174-206`), as `getSettings`, `uploadRemoteFile` and
`getPresignedAuthNonce` already do.

One requirement follows for D.3: authenticating a request is not the same as
attributing a write. `saveSourceFilePatch` sends `authorId` in the request body
alongside the credential (`ValOpsHttp.ts:791-817`), so a write must be attributed
to the **authenticated principal** rather than to whatever the body claims.

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
`val login` is an RFC 8628 device authorization grant: `startValLogin` requests
one and returns the user code plus the verification URL,
`awaitValLoginConfirmation` polls with the device code until it is approved, and
`persistPersonalAccessToken` writes `.val/pat.json` at mode `0600`
(`login.ts`).

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
                                           content API resolves the PAT to a
                                           profile and checks project access
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
enough that revocation (D.4) means something. Cache negative results briefly
(a few seconds) so a bad token cannot turn the route into a backend
amplification vector, and never log the token.

Handling rules for the PAT inside the route: accept it from the
`Authorization: Bearer` header only (never a query parameter — those end up in
access logs), and pass it to the registry via `ctx.auth`, not via any structure
that gets serialized into logs, traces, or MCP results.

**What Stage 2 needs from the backend is small** — one addition (D.3) plus the
lifecycle work in D.4. The PAT-to-profile resolution already happens on every
authenticated request; what is missing is a way for the app to _learn_ the
resolved identity, since `/settings` today returns only
`{publicProjectId, remoteFileBuckets}` (see the client schema in
`getSettings.ts:6-9`).

### D.3 The backend addition

Two requirements, both small, and best landed together:

1. **Expose the authenticated principal.** Either add
   `profile: { profileId, role }` to the `/settings` response, or add a
   `whoami` endpoint returning the same. Extending `/settings` is preferable
   because `ValServer` and the CLI already call it with PAT auth
   (`getSettings.ts:26-36`), so the client plumbing exists. The value must be
   derived from the **authenticated** principal, never from a request header.
2. **Bind `authorId` to the authenticated principal.** Where a write records an
   author and the request authenticated as a specific user (PAT or nonce), the
   recorded author must be that resolved principal rather than whatever the
   request body carries — `ValOpsHttp` sends `authorId` in the body
   (`ValOpsHttp.ts:791-817`), so without this the field is a claim rather than a
   fact. The API-key path has no authenticated end user to bind to, which is the
   asymmetry D.9 eventually removes.

Val exports the verifier (`verifyValPat` in `@valbuild/server`, a thin cached
wrapper over the extended `/settings`); the template calls it from
`withMcpAuth`'s `verifyToken`.

### D.4 Credential lifecycle: the Stage 2 release gate

MCP is what turns the PAT from an occasional developer convenience into a
credential that exists in quantity and sits in plaintext client config files on
disk. So the controls around its lifecycle have to be in place **before** it
becomes the advertised way for an agent to reach Val content. These are backend
concerns, tracked privately rather than enumerated here; what matters for this
plan is which properties Stage 2 depends on:

- **Hashed at rest**, so that a credential store is not itself a set of usable
  credentials, with digest comparison rather than string equality.
- **Listable and revocable by the owner**, showing when each token was issued
  and which machine issued it, never the value. D.5 rejects reusing the Studio
  session cookie _because_ a PAT is separately revocable, so that has to be
  true in practice, not just in principle.
- **Expiring.** A default lifetime (90 days was the proposal) with expiry
  enforced at the point identity is resolved, so a lapsed or revoked token stops
  working on the next request rather than at the mercy of a cache. `val login`
  re-issues cheaply. Existing tokens can stay non-expiring so that adding this
  logs nobody out.
- **Issued only with explicit consent.** `val login` is an RFC 8628 device
  authorization grant: the CLI holds a `device_code` and polls with it, the user
  handles only a short `user_code`, and approval is an explicit act on a screen
  naming the machine that asked. Note that RFC 8628 does not on its own prevent
  device-code phishing — §5.4 is explicit about this — so the consent screen and
  the code comparison are load-bearing, not decoration.

The first three are the release gate. The fourth already ships (see the RFC 8628
work in `packages/server/src/login.ts`).

### D.5 Why not the session cookie

The obvious cheaper move is to accept the `val_session` JWT as a bearer token: it
is verifiable locally with `VAL_SECRET` (HMAC), and its `sub` is already the
author id, so it needs **no backend work at all**. Rejected, for three reasons:

1. **It conflates two lifecycles.** The session cookie is the human's Studio
   login. Reusing it as an agent credential means you cannot revoke the agent
   without logging the person out, or rotate a leaked agent token without
   invalidating browser sessions. A PAT is separately revocable — once the D.4
   controls land.
2. **The JWT embeds a second, higher-value credential.**
   `IntegratedServerJwtPayload` (`ValServer.ts:2999-3005`) carries `token` — the
   JWT the app uses as a **Bearer credential against admin.val.build**
   (`ValServer.ts:676-691`). MCP client configs are plaintext files on disk and
   are routinely committed by accident. A PAT is purpose-scoped; a session JWT
   is not.
3. **The UX is "copy it out of devtools."** `val login` already exists and is
   strictly better.

It would also require the D.8 fix first: `decodeJwt` never checks `exp`, so a
pasted session token is accepted by the server **forever**, not merely for the
cookie's client-side lifetime.

### D.6 Why not verify-then-assert (the first draft's Stage 2 — rejected)

The first draft had the route resolve the PAT to a `profileId`, then execute
tools through the app's existing `ValOpsHttp(auth: { apiKey })`, asserting the
resolved id via `x-val-profile-id`/`authorId`. Pass-through (D.2) dominates it on
every axis:

- Verify-then-assert makes the MCP route a **confused deputy**: on the API-key
  path the asserted profile id is taken at face value (D.0), so the route's own
  token check would be the only thing standing between a forged request and
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

**Authorization-server requirements.** The Studio's existing browser login has
an `/authorize` → code-exchange shape (`ValServer.ts:170-208`, `:529-541`,
`:603-640`), and an earlier draft of this plan hoped that was most of an OAuth
authorization server already. It is not: it is an internal code relay for one
known client, so Stage 3 should treat it as **replace, not extend**. Its own
hardening is tracked separately from this plan and is worth doing regardless of
whether Stage 3 ever happens.

Assume the authorization server is new build. In particular there is no
asymmetric-key or JWKS infrastructure to build on — both JWTs in the current
system are HS256 with shared secrets (`VAL_SECRET` on the app side; see
`packages/server/src/jwt.ts`). What it must provide:

- **RFC 8414 metadata** at `/.well-known/oauth-authorization-server`.
- **OAuth 2.1**: authorization code with **PKCE `S256` mandatory**.
- **RFC 8707**: honour `resource` on authorization and token requests; set `aud`.
- **RFC 9207**: return `iss` in the authorization response. New in this revision.
- **Client registration**: current ordering is **Client ID Metadata Documents
  (CIMD) preferred → pre-registration → Dynamic Client Registration, which is
  deprecated**. DCR was the usual answer for MCP and is now the fallback.
- **Scopes**: at least `val:read` / `val:write`. Org membership already carries a
  role (`owner`/`developer`/`editor`) for these to hang off, but the content API
  does not enforce roles today, so scope enforcement is new code either way.
  Finer granularity is much harder to add later than now.
- **JWKS endpoint** — prefer JWT access tokens validated against JWKS over RFC
  7662 introspection, so the serverless route needs no per-request round trip.
- **Consent screen** naming the resource (the flow above shows the AS currently
  has no consent surface of its own, so budget for building one).

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
  belong to** — treat it like a password, prefer per-agent PATs now that they can be listed and revoked, and revoke on any suspicion. Note the header is right for Stage 2
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

1. **Backend credential-lifecycle work** (D.4): hashing at rest, PAT listing and
   revocation with expiry, and the consent step in `val login` (already
   shipped). This gates the Stage 2 _release_, not the Stage 2 _build_ — run it
   in parallel with 2–6.
2. Move shared helpers to `@valbuild/shared/internal` — separate commit, Studio
   tests green.
3. Registry skeleton + read-only tools + unit tests.
4. Write path (Part C) + write tools + tests.
5. `examples/next` MCP route; exercise locally with **no auth at all** (D.1),
   including the production-refusal guard and Origin/Host validation.

   → **Steps 2–5 are the natural first PR**: a working local MCP server with no
   backend dependency whatsoever.

6. Backend addition (D.3): expose the authenticated principal on `/settings`,
   and bind the recorded author to the authenticated principal on writes.
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
- **Revocation**: revoke the PAT, then confirm calls
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

## Questions the backend side settled (2026-08-30)

An earlier draft of this plan carried a list of open questions about the hosted
backend. They have been answered; the answers are summarised here because they
are what the design above rests on.

1. **Can a PAT be resolved to a profile?** Yes, and it already happens on every
   PAT-authenticated request. What was missing is a way for the app to _learn_
   the resolved identity, which is the D.3 addition.
2. **Are PATs revocable per token, with somewhere to see them?** They are now —
   this is the D.4 work, and it matters for the plan's internal logic because
   D.5 rejects reusing the Studio session cookie _on the grounds_ that a PAT is
   separately revocable.
3. **Is a write attributed to the authenticated caller?** Not inherently: the
   author travels in the request body (`ValOpsHttp.ts:791-817`), so binding it
   to the authenticated principal is a requirement rather than a given. D.3.
4. **Is the Studio's existing browser login a usable OAuth authorization
   server?** No — treat Stage 3 as new build (D.7).
5. **Is there JWKS or asymmetric-key infrastructure to build on?** No. Both
   current JWTs are HS256 with shared secrets, so a Stage 3 AS starts from
   scratch; consider a maintained provider library rather than hand-rolling.
6. **What scope granularity exists?** Org-level roles
   (`owner`/`developer`/`editor`) exist for scopes to hang off, but the content
   API does not enforce roles, so scope enforcement is new code either way.
7. **Can the content API accept a user credential directly?** It already does —
   that is the PAT path, and discovering it is what turned Stage 2 into
   pass-through (D.2/D.6). What remains is binding writes to the authenticated
   identity (D.3) and eventually retiring asserted identity for the Studio (D.9).

**Still open:** the default PAT lifetime (90 days proposed), and whether an
`editor`-role member should hold a PAT carrying full content-API power, given
that role is not currently enforced (answer 6).

---

## Risks

1. **Stage 2's release gate is known work, not an unknown.** The backend
   addition (D.3) is small, but the D.4 lifecycle work (hashing at rest,
   listing and revocation, expiry) is real and gates the release. Steps 2–5 stay
   independent of it, so a delay there stalls shipping rather than building.
2. **Two tool definition sets will drift** (Studio's and MCP's). Accepted for now;
   identical names keep convergence cheap.
3. **Concurrent writes** — MCP callers and Studio users share the patch chain.
   `patch-head-conflict` plus one retry is the plan; whether that suffices under a
   long agent run is untested.
4. **Moving helpers touches the live chat path** (`useAI.ts` imports). Hence the
   separate commit.
5. **Stage 2 has no audience binding, and a PAT is account-wide** — broader than
   the first draft assumed. A PAT is accepted for any project its owner has
   access to, at any role, so one leaked PAT reaches everything that person can
   reach rather than just the deployment it was configured for. Stage 3's RFC
   8707 `aud` plus scopes is the fix; until then the README warning (Part E) and
   the D.4 lifecycle controls (expiry, revocation, hashing) are the mitigations.
   Accept knowingly, and keep it in mind when deciding how widely PATs are
   handed out.
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
