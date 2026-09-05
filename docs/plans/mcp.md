# MCP support for Val — the plan, and what shipped

> **Status, 2026-09-05: built and shipped.** This started as a plan and is now
> the design record for something that exists. It has been reconciled with the
> code that shipped; where the build diverged from the plan, the divergence and
> its reason are recorded rather than edited away, because the reasons are the
> part worth keeping.
>
> - **0.116.0** — the tool registry in `@valbuild/server`, the MCP endpoint, and
>   Stage 2's personal-access-token path ([#558](https://github.com/valbuild/val/pull/558)).
> - **0.117.0** — Stage 3's resource server: OAuth access tokens verified in
>   `@valbuild/next`, the `WWW-Authenticate` challenge, and protected-resource
>   metadata ([#582](https://github.com/valbuild/val/pull/582)).
> - **0.120.1 / 0.120.2** — a token naming an unknown key provokes one
>   rate-limited JWKS refetch instead of a refusal, so a key rotation on the
>   issuer's side is not an outage on yours
>   ([#590](https://github.com/valbuild/val/pull/590)).
>
> Val's authorization server is live at `https://admin.val.build`. Its endpoints
> and the guarantees a resource server may rely on are in D.7.
>
> **How to use this document.** It is written to be self-contained: paste it into
> a fresh session that has `valbuild/val` and `valbuild/template-nextjs-starter`
> attached. Nothing here assumes context from the session that produced it.
>
> Claims about `valbuild/val` carry a `file:line`. Those were verified against
> the code on 2026-08-30 and the files have moved since, so read a line number as
> a hint about where to look rather than a fact. Claims about the MCP spec and
> npm packages were verified the same day against the raw published sources.
>
> Part D describes what the hosted backend (admin.val.build and
> content.val.build) provides. That side is not open source, so it is described
> by observable behaviour rather than by its internals. Everything stated here
> about the backend's request protocol is observable from `packages/server` in
> this repository.

---

## Goal

Make Val content editable from any MCP client (Claude Code, Cursor, custom
agents), with **Val exposing the tools and the auth** and **the template defining
the actual MCP server**, so other MCP hosts can consume the same tools.

Authentication shipped in two stages, and **both are live**. Stage 2 is
**personal access tokens**, reusing the `val login` device flow Val already had:
the MCP route forwards the caller's PAT to content.val.build as the credential
for every backend call, so the backend — not the app — authenticates the user.
Stage 3 is **OAuth 2.1**: an MCP client discovers Val's authorization server
from the app, the person approves it on a consent screen, and the app verifies
the resulting access token itself against the issuer's published keys. Local
development needs no credential at all, on either path.

**Checking the design against the backend changed it in two ways.** First, the
content API already accepts a PAT as a first-class credential on every endpoint,
and `ValOpsHttp` already knows how to send one (`ValOpsHttp.ts:174-206`) — so
Stage 2 does not need the app to verify tokens and assert identity on the
backend's behalf. It can pass the PAT through and let the backend enforce it,
which is both safer and less code (D.2, D.6).

Second, a set of hardening items on the credential's own lifecycle gated the
release rather than the build (D.4). Shipping MCP multiplies how many PATs exist
and how long they sit in plaintext MCP client configs on disk, so the controls
around issuing, listing and revoking them had to be in place before PATs became
the advertised credential for agents. They were, before 0.116.0 went out.

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
@valbuild/server/tools        ← Transport-agnostic registry. No MCP SDK.          per request with the
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

`packages/server/src/tools/`, shipped in 0.116.0.

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
   * Who is calling, established per request by the host. `null` only in local
   * fs mode, where there is no credential (Part D.1).
   *
   * Shipped as a union rather than the single shape this plan first drew,
   * because the two credentials give the host different standing:
   *
   *   type ValToolAuth =
   *     | { type: "pat"; pat: string }
   *     | { type: "verified-profile"; profileId: AuthorId; scopes: string[] };
   *
   * A PAT is relayed and carries no identity — the app cannot check it, so it
   * does not get to name who sent it (D.2). An access token's `sub` is a fact
   * the app established against the issuer's published key, so it may be
   * attributed and its scopes enforced (D.7).
   */
  auth: ValToolAuth | null;
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

  **(2) shipped, not the preferred (1)**: a map of `ValOps` instances keyed by
  `sha256(pat)`, so the same caller reuses their own instance and two callers can
  never share one (`packages/server/src/tools/createValTools.ts`). The reason for
  preferring (1) was that instance-level caches must not leak between callers,
  and keying by the credential answers that directly — where threading auth
  through every method would have touched every proxy-mode call site to arrive at
  the same place. Hashing the key is not a security boundary, since the instance
  holds the token either way; it keeps credentials out of the key set, which is
  what ends up in a heap dump.

  **The app-level `VAL_API_KEY` is never the credential for a PAT-authenticated
  call** — see D.6. It _is_ the credential for an OAuth-authenticated one, with
  the verified `sub` travelling as `authorId`; D.7 says why that is a different
  case rather than the same mistake.

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

**All eleven shipped in 0.116.0**, under these names, in
`packages/server/src/tools/{readTools,writeTools}.ts`. The deferred four are
still deferred.

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

Two stages, **both shipped**. Stage 2 was the shipping target and Stage 3 the
destination, kept here so Stage 2 would not be built in a way that foreclosed
it; in the event Stage 3 followed one release later. Between them sits D.4 —
credential-lifecycle work that gated the Stage 2 _release_, because MCP turns
PATs into a first-class, widely-distributed credential.

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

**Both shipped, and in `@valbuild/next` rather than per app**
(`initValMcp.ts`, `refuseUnsafeRequest`), because they are security-relevant and
an app should not be re-implementing them. Filesystem mode is refused outside
`NODE_ENV=development`, with no flag to turn that off: there is no configuration
that makes an unauthenticated write endpoint safe on a deployed host, so a
project that wants MCP in production wants proxy mode. A request carrying a
cross-origin `Origin` is refused in either mode, and `Origin: null` — the opaque
origin, from a sandboxed iframe or a `file://` page — is refused with the rest,
because it cannot be compared to anything and "cannot be compared" has to mean
refuse. In fs mode the request must also be addressed to a loopback host, which
is the `Host` check DNS rebinding needs. MCP clients are not browsers and send no
`Origin`, so none of this costs them anything.

### D.2 Stage 2 — PAT pass-through (shipped, 0.116.0)

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
                                             │ the route does not verify it, and
                                             │ derives no identity from it
                                             ▼
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

**The route-level verification this plan called for did not ship, and should
not.** The idea was that the route would resolve the PAT to a `profileId` first
(D.3) — to reject garbage early, to satisfy `withMcpAuth`'s `verifyToken`
contract, and to fill in `ctx.auth` — behind a cache keyed by `sha256(pat)` with
a TTL short enough that revocation still meant something. Building it made the
argument against it plain. A `profileId` the app looked up is still an identity
the app is _asserting_, and there is nothing here for it to do: `authorId` is
`null` on this path, and the only party that resolves this credential to a
profile is the backend. All the check would add is a network round trip per
cold call, a TTL to reason about, and a second copy of the answer that can
disagree with the authoritative one.

So the PAT is relayed as-is, `ctx.auth` is `{ type: "pat", pat }` with no
identity field — the type has no room for one — and the backend decides what it
may do. What this section said about handling still holds and is what shipped:
accept it from `Authorization: Bearer` only, never a query parameter, never log
it, and never let it reach a tool result.

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

**Requirement 1 was superseded before it was built; requirement 2 still
stands.**

Exposing the authenticated principal was for the app's benefit, so it could name
its caller. Stage 3 gives it a better answer than a `whoami` endpoint could: an
access token's `sub` is signed by the authorization server, so the app knows the
caller from the token in hand, with no round trip and nothing to cache. On the
PAT path the app deliberately does not learn the caller at all (D.2). So there is
no `whoami`, no `profile` in the client's `/settings` schema, and no
`verifyValPat` in `@valbuild/server` — that function was named here and never
existed.

Binding the recorded author to the authenticated principal is a different matter
and still belongs on the backend, which on the PAT path is the only party that
resolves the credential to a profile. On the OAuth path the app supplies an
`authorId` it verified cryptographically, which is a fact rather than a claim —
see D.7.

### D.4 Credential lifecycle: the Stage 2 release gate (met)

MCP is what turns the PAT from an occasional developer convenience into a
credential that exists in quantity and sits in plaintext client config files on
disk. So the controls around its lifecycle had to be in place **before** it
became the advertised way for an agent to reach Val content. These are backend
concerns rather than anything in this repository; what matters here is which
properties Stage 2 depends on:

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

The first three were the release gate. Hashing at rest, and owner-visible
listing and revocation naming the machine that asked for each token, were in
place before 0.116.0 shipped. Expiry is the one whose default lifetime is still
undecided — see _Still open_, below. The fourth already shipped: see the RFC
8628 work in `packages/server/src/login.ts`.

### D.5 Why not the session cookie

The obvious cheaper move is to accept the `val_session` JWT as a bearer token: it
is verifiable locally with `VAL_SECRET` (HMAC), and its `sub` is already the
author id, so it needs **no backend work at all**. Rejected, for three reasons:

1. **It conflates two lifecycles.** The session cookie is the human's Studio
   login. Reusing it as an agent credential means you cannot revoke the agent
   without logging the person out, or rotate a leaked agent token without
   invalidating browser sessions. A PAT is separately revocable — which the D.4
   controls made true in practice, not just in principle.
2. **The JWT embeds a second, higher-value credential.**
   `IntegratedServerJwtPayload` (`ValServer.ts:2999-3005`) carries `token` — the
   JWT the app uses as a **Bearer credential against admin.val.build**
   (`ValServer.ts:676-691`). MCP client configs are plaintext files on disk and
   are routinely committed by accident. A PAT is purpose-scoped; a session JWT
   is not.
3. **The UX is "copy it out of devtools."** `val login` already exists and is
   strictly better.

It would also have required the D.8 fix first: at the time this was written
`decodeJwt` never checked `exp`, so a pasted session token was accepted by the
server **forever**, not merely for the cookie's client-side lifetime. That is
fixed now, and the other three reasons are untouched by it.

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

### D.7 Stage 3 — OAuth 2.1 (built, 0.117.0)

Stage 2 was a stepping stone rather than a detour, and Stage 3 followed one
release later. It is live: an MCP client discovers Val's authorization server
from the app, registers itself, sends the person to a consent screen, and comes
back with an access token the app verifies on its own.

Roles, as the plan drew them: the Next app's `/api/mcp` is the **Resource
Server**, `https://admin.val.build` is the **Authorization Server**, and the
resource identifier is the endpoint's own URL. The Studio's existing browser
login was not reusable — it is an internal code relay for one known client, not
an authorization server — so this was new build, as the plan expected.

#### The resource server (this repository)

`initValMcp(valModules, config, { oauth: { issuer, resource } })` turns an
endpoint into a resource server. `@valbuild/next` ships the whole of it, on
purpose: these are the security-relevant checks, and an app should not be
re-implementing them per deployment.

- **RFC 9728 protected-resource metadata.** `valMcpMetadata` is a
  `{ GET, OPTIONS }` pair to mount at `/.well-known/oauth-protected-resource`,
  and it is `null` when the app has no `oauth` config — so a deployment that
  does not do OAuth answers 404 rather than publishing a document naming no
  authorization server, which would send clients into a discovery loop. The
  _authorization server's_ own metadata (RFC 8414) is deliberately not served by
  the app: that document describes the issuer's endpoints, belongs at the
  issuer, and an app serving a copy would be asserting someone else's
  configuration and would be wrong the moment it changed.
- **401 with `WWW-Authenticate`** carrying `resource_metadata` and `scope`, and
  **403 on insufficient scope** — the distinction RFC 6750 section 3.1 draws,
  and the one that tells a client whether to authorize again or to give up.
- **Token validation** in `packages/next/src/server/valAccessToken.ts`, over
  `node:crypto`. The rules that keep it safe are worth stating, because each is
  there for a reason this repository has already met (D.8 is the
  counterexample it shipped):
  - **`alg` is pinned to ES256**, never read from the token; the header is
    consulted for `kid` alone. A verifier that honours the token's own `alg` can
    be handed `HS256` and will treat the _published public key_ as a shared
    secret.
  - **Nothing is read from the payload before the signature verifies.** Claims
    from an unverified token are attacker input.
  - **Keys come only from the configured issuer's JWKS** —
    `new URL("/.well-known/jwks.json", issuer)` — never from the token. Cached
    five minutes; a `kid` the cache does not hold provokes one refetch, rate
    limited to once per issuer per 30 seconds. The limit matters because the
    `kid` comes from the token: without it, unknown key ids are a way to make
    the app call its issuer once per request.
  - **Every claim that bounds the token is checked**: `iss`, `aud`, `exp`
    (required) and `nbf`, with a clock-skew allowance, plus a non-empty `sub`
    and a `scope` containing `val:read`.
- **Scopes enforced before a tool runs** — `val:read` for every call, `val:write`
  in addition for any tool not marked `readOnlyHint`. Enforced here as well as by
  the backend, deliberately: this check can refuse a write before it is
  attempted, so a token that may only read never reaches the code that builds a
  patch.

`jose` was the first choice and was rejected on a fact rather than a preference:
version 6 is ESM-only, and this package is built by preconstruct and `require`d
by Next.js server code, so an ESM-only dependency here is a runtime failure in
consumers' apps rather than a build inconvenience. The cryptography is still not
hand-rolled — `node:crypto` does the ECDSA and the JWK import — but the JWS
envelope is written out. One thing to know before touching it: **ECDSA JWS
signatures are raw `r||s`** (RFC 7518), not DER, which is what
`dsaEncoding: "ieee-p1363"` is for. Omit it and every valid signature is
rejected.

**On this path the app's API key is the backend credential, and the verified
`sub` travels as `authorId`** — which is the shape D.6 rejects. The difference is
what "verify" means there. D.6 rejects asserting an identity the app took on
trust from a credential it cannot check; here the app checked a signature
against the issuer's published key, so the `sub` is a fact it established rather
than a claim it relayed — the same standing the Studio has for a session it
established itself. The types are made to say so: `ValToolAuth` has no identity
field on its `pat` variant, and the single assertion that turns a string into an
`AuthorId` is named `authorIdFromVerifiedSubject`, so a `profileId` that was not
verified has nowhere to enter the system.

#### The authorization server (admin.val.build)

Observable behaviour, which is what a resource server may rely on:

| Endpoint                                      | What it does                                                                                                  |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `POST /oauth/register`                        | RFC 7591 dynamic client registration. Open, and returns a `client_id` with no secret.                         |
| `GET /oauth/authorize`                        | Sign-in, then a consent screen naming the client and the project. Returns `iss` (RFC 9207) on every response. |
| `POST /oauth/token`                           | Authorization-code and refresh-token grants, form-encoded, with no client authentication.                     |
| `GET /.well-known/oauth-authorization-server` | RFC 8414 metadata.                                                                                            |
| `GET /.well-known/jwks.json`                  | The ES256 public keys.                                                                                        |

The properties that the code in this repository depends on:

- **PKCE `S256` is mandatory.** It is the only method advertised, and a request
  without a challenge is refused. Every client is public, so possession of the
  verifier is what a client proves at the token endpoint — there is no secret.
- **RFC 8707 `resource` is honoured** on both the authorization and the token
  request, and becomes the token's `aud`. It resolves to a project by the
  **exact origin** of that project's production URL, so a token is bound to one
  deployment rather than to anything that merely starts with the same string.
- **Access tokens are ES256 JWTs**, one hour, verifiable against the JWKS with no
  round trip to the issuer — per-request introspection would be the wrong shape
  for a serverless route.
- **Scopes are `val:read` and `val:write`**, narrowed to what the person's role
  in that project's organisation carries, and **re-checked when a refresh token
  is exchanged** rather than only at consent, so losing access ends the session
  at the next refresh.
- **Refresh tokens rotate**, and presenting one that was already spent is treated
  as a replay: the whole family is torn down, so a stolen token cannot be used
  alongside the legitimate one.
- **Consent is per client, per project**, and nothing an app or a client can do
  produces a token without a person approving it on a screen naming both.

#### The two decisions this plan left open, and where they landed

1. **`aud` is the MCP endpoint's own URL** — as recommended, and proved inside
   the exchange rather than assumed: the client sends `resource`, the
   authorization server resolves it and stamps it as `aud`, and the app refuses
   any token whose `aud` is not its own configured `resource`. A token minted for
   one Val site is not accepted by another.

2. **Clients register themselves; there is no pre-registration.** This plan put
   dynamic client registration last, behind Client ID Metadata Documents and
   pre-registration, on the strength of the spec's ordering. What shipped is RFC
   7591 dynamic registration, because the ordering in the spec is not the
   ordering in the clients: the MCP clients this exists for expect to register
   themselves, and nobody is going to hand-register an agent in an admin screen
   before a customer can connect it.

   Open registration is safe **because a registration grants nothing**. A client
   is a name and a set of redirect URIs, and it stays powerless until a signed-in
   person approves an authorization request for it. What the registration buys is
   the two things that make a code safe to hand out: something honest to put on
   the consent screen, and a redirect URI pinned in advance — compared by exact
   string equality, so a stolen `client_id` cannot deliver a code anywhere else.
   Redirect URIs must be `https`, or `http` on a loopback host for local
   development, and must carry no fragment; registration is rate-limited per
   address; and the client name is untrusted display data, which is the only
   thing a registrant gets to say about itself.

**What Stage 3 gives that Stage 2 could not:** third-party clients that expect
OAuth discovery (connector UIs are OAuth-oriented and often cannot be given a
static header at all), scoped least privilege, and per-resource audience
binding.

**Still unbuilt:** a screen where a person can see which applications hold a
grant and withdraw one, and rotation of the signing keys on a schedule. The
resource-server half of rotation is done — an unknown `kid` refetches rather than
refusing, from 0.120.1 — so what is missing there is the schedule, not the
ability to survive it.

### D.8 Prerequisite fix in `packages/server`, separate PR (done)

`decodeJwt` (`packages/server/src/jwt.ts:11-66`) had three problems:

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

**Done, in its own PR, as this section asked** — changing `decodeJwt` changes
login behaviour and had no business riding inside an MCP change. It is
`verifyJwt` now (`packages/server/src/jwt.ts`): the secret is required, with no
argument shape that skips the signature check; the comparison is
`crypto.timingSafeEqual` behind the length check that makes it usable; `exp` is
enforced with a 60-second allowance for clock skew; and the header pins `alg` to
`HS256`, so `alg: "none"` and the rest of the algorithm-confusion family are
rejected before the signature is looked at. The one legitimate unverified call is
named `decodeJwtWithoutVerifying` and its doc comment says what makes it
legitimate, so the default path cannot silently skip verification.

### D.9 Follow-on worth designing toward

The end state D.5 of the first draft hoped for — content.val.build accepting the
**user's** credential directly and deriving the author itself — is **already
half-real**: the PAT path does exactly that, and D.3.2 completes it by binding
`authorId` server-side.

What remains is retiring the API-key-plus-asserted-identity path for the Studio,
and Stage 3 removed the reason it could not be done: Val's authorization server
issues user tokens now, so the Studio's server could forward one instead of
asserting `x-val-profile-id` under `VAL_API_KEY`, and the API key would shrink to
app-level concerns (deploy hooks, settings). Note that the MCP OAuth path did not
take this route — it verifies the token itself and calls the backend under the
API key with a verified `authorId` (D.7) — so this is still a design to move
toward rather than one already half-taken. Nothing in the authorization server
forecloses it: content.val.build can be registered as a second resource.

---

## Part E — template wiring

Verified npm state (2026-08-30): `mcp-handler@2.1.1`, peer
`@modelcontextprotocol/server@^2.0.0` and `next >=13`. The `[transport]` catch-all
and the Redis requirement are **gone** in 2.x — a plain `route.ts` exporting
`GET`/`POST` is the whole thing. The 2026-07-28 protocol revision is stateless: no
`initialize`, no `Mcp-Session-Id`.

**`examples/next` has this; `template-nextjs-starter` does not yet.** The example
is in Val's CI, which is what makes it the reference rather than the copy: its
`pnpm run build` is the job that catches the duplicate-`@types/react` class of
failure, so the MCP path does not ship untested. Porting the same three files to
the template is outstanding.

Three files, and what belongs in each:

- **`val/mcp.ts`** — `"server-only"`, and one call:

  ```ts
  const { valMcpAuthorize, valMcpTools, valMcpMetadata } = initValMcp(
    valModules,
    config,
    {
      formatter: (code, filePath) =>
        prettier.format(code, { filepath: filePath }),
      // Absent by default, because the two are genuinely different
      // deployments: local development has no authorization server to talk to
      // and wants the endpoint to work without one, while a deployed app must
      // not serve MCP to whoever asks. Set both and every call needs a verified
      // access token.
      ...(process.env.VAL_OAUTH_ISSUER && process.env.VAL_MCP_RESOURCE
        ? {
            oauth: {
              issuer: process.env.VAL_OAUTH_ISSUER,
              resource: process.env.VAL_MCP_RESOURCE,
            },
          }
        : {}),
    },
  );
  ```

  Separate from `val/server.ts` because the two share nothing but the modules:
  one serves the Studio in a browser, the other serves an agent that has none.
  The formatter goes to both, so a patch written to disk in local dev comes out
  formatted the way the repo formats everything else, whichever path wrote it.

- **`app/api/mcp/route.ts`** — **outside both route groups**. Route handlers
  never render a layout, so the `(main)`/`(val)` split (which exists because each
  group owns its own root layout) does not apply; a top-level `api/` keeps MCP
  independent of both.

  `valMcpAuthorize` is called **twice**, and both are load-bearing. Once on the
  raw request before `createMcpHandler` sees it, so a request that should not be
  answered at all — a browser on another origin, or fs mode on a deployed host —
  never reaches an `initialize` handshake. And once inside each tool callback,
  from that call's own `ctx.http?.req`, because the credential belongs to the
  caller rather than to the server instance the tools were registered on.
  Listing needs no credential, so the tools are registered once at startup;
  only calling them is per-caller. Export the same function as `GET`, `POST` and
  `DELETE`.

  A tool that fails returns its error **in band**, with `isError: true`, so the
  model sees a failed tool call it can recover from rather than a dead
  transport. The error code goes in the text, because it is what distinguishes
  "try something else" from "try again".

  Note there is no `withMcpAuth` and no `verifyValPat`: the plan had the route
  wire `mcp-handler`'s auth wrapper around a Val-supplied verifier, and what
  shipped puts the whole decision behind `valMcpAuthorize` in `@valbuild/next` —
  the OAuth path, the PAT path, the fs-mode refusal and the origin check in one
  place. See D.2 and D.3 for why the verifier stopped being needed.

- **`app/.well-known/oauth-protected-resource/route.ts`** — `valMcpMetadata.GET`
  and `.OPTIONS`, or 404 when `valMcpMetadata` is `null`. Not the SDK's
  `protectedResourceHandler`: this document has to agree with the `oauth` config
  the same `initValMcp` call was given, and two sources for one answer is how
  they come to disagree.

- **`.env.example` + README** — the Val project vars, and how to attach the
  server. With OAuth configured, a client discovers everything it needs and no
  header is involved:
  `claude mcp add --transport http val https://site.com/api/mcp`. For the Stage 2
  PAT path, add `--header "Authorization: Bearer $VAL_PAT"` — and the README must
  say plainly what a PAT is worth (Risks 5): it grants everything its owner can
  touch, across **every project of every org they belong to**. Treat it like a
  password, prefer per-agent PATs now that they can be listed and revoked, and
  revoke on any suspicion. **Do not configure both**: once a server advertises
  OAuth, a rejected `Authorization` header is reported as a failure rather than
  falling through to the OAuth flow.

`package.json`: add `mcp-handler@^2`, `@modelcontextprotocol/server@^2`, `zod@^4`,
and `"engines": { "node": ">=20" }` (both packages require it; the template
currently declares none). `tsconfig.json` needs `"types": ["node"]` — TypeScript
≥6 no longer auto-includes `@types/*` and the SDK's `.d.mts` references `Buffer`.

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

## What was done, in order

The plan's ten steps, with what actually happened to each:

1. **Credential-lifecycle work (D.4).** Done, and it did gate the release rather
   than the build: hashing at rest, plus listing and revocation naming the
   machine that asked, were in place before 0.116.0 went out.
2. **Move shared helpers to `@valbuild/shared/internal`.** Done as its own
   commit, with the Studio's tests green, so nothing in the live chat path had
   to be untangled from a registry regression afterwards.
3. **Registry skeleton + read-only tools + unit tests.** Done.
4. **Write path (Part C) + write tools + tests.** Done.
5. **`examples/next` MCP route.** Done — with the production refusal and the
   origin check in `@valbuild/next` rather than in the app, which was the one
   change worth making to this step (D.1).
6. **Backend addition (D.3).** Superseded rather than built. Stage 3 arrived
   before there was any need for it, and a verified `sub` from the token beats
   an identity the app looks up and caches; see D.3.
7. **Per-request auth threading.** Done as instance-per-credential rather than
   as a parameter on every method (Part A), and without `verifyValPat`, which
   step 6 removed the need for.
8. **Ship it.** 0.116.0.
9. **`decodeJwt` fixes.** Done, in their own PR, as D.8 insisted.
10. **Stage 3 (D.7).** 0.117.0, one release after Stage 2 rather than "when
    third-party OAuth clients justify it" — the connector UIs justified it
    immediately.

Left:

- **Port the three files to `template-nextjs-starter`** (Part E), so a new
  project starts with MCP wired rather than with instructions for wiring it.
- **A grant-management screen** on the authorization server, so a person can see
  which applications hold access and withdraw one (D.7).
- **Scheduled signing-key rotation** (D.7). Resource servers survive one already;
  what is missing is the schedule.
- **`search_content`** (Part B), which needs a server-side index lifecycle rather
  than a new algorithm.
- **Image tools over MCP** (Part B), which need an affordance MCP has and chat
  does not — a local file path, or inline base64.

## Verification

What was run, and what to re-run when any of this changes.

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
  challenge; a garbage PAT → refused by the backend rather than by the route
  (D.2); a valid PAT → tools run and the created patch's author is the PAT
  owner's profile (checked in the Studio's patch list), **even when the request
  body claims a different `authorId`** (D.3.2).
- **Revocation**: revoke the PAT, then confirm calls fail. On this path there is
  no route-level cache to wait out — the backend re-checks every call.
- **No leakage**: grep route/server logs from the above runs for the raw PAT —
  it must appear nowhere.

For the OAuth path, all of this was verified end to end against the deployed
authorization server before 0.117.0 shipped: the 401 challenge and its
`WWW-Authenticate`, both metadata documents, a full register → authorize →
consent → token exchange, and the resulting token accepted by the released
verifier. Then the refusals, which are the half worth re-running whenever any of
it changes — a token minted for a **different resource** refused on `aud`, one
from a **different issuer** refused on `iss`, and one whose payload was edited
after signing refused on the signature.

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

**Answered since, by building it.** 4 and 5 were right that Stage 3 was new
build with no asymmetric-key infrastructure to stand on; it is ES256 with a
published key set now (D.7). 6 landed where the plan hoped: `val:read` and
`val:write` exist, are derived from the member's role, and are enforced both by
the resource server before a tool runs and by the backend.

**Still open:** the default PAT lifetime (90 days proposed), and whether an
`editor`-role member should hold a PAT carrying full content-API power, given
that role is not enforced on that path (answer 6). Both are now specifically
_PAT_ questions: an OAuth access token is scoped by role and bound to one
resource, so the answer for agents is increasingly to use Stage 3 and hand out
fewer PATs.

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
   8707 `aud` plus scopes **is the fix, and it shipped**: an access token is
   bound to one endpoint and carries only what the person's role allows. The PAT
   path stays, for local use and for clients that can only be given a header, so
   the warning stands for it — prefer OAuth wherever the client supports it, and
   keep the D.4 controls (revocation, hashing) as the mitigation for the rest.
6. **Connector UIs are OAuth-oriented**, so a static bearer header may not be
   configurable there at all — which is the risk that argued for going straight
   to Stage 3, and did. **Resolved by shipping it:** a deployment with `oauth`
   configured is exactly what such a UI wants, since it discovers the
   authorization server from the protected-resource document and runs the flow
   itself with nothing to configure. Clients that take a header directly still
   work on the PAT path. The clients do not behave identically, so test them
   separately.
7. **Per-request auth threading in `ValOpsHttp` touches every proxy-mode call
   site.** The change is mechanical (Part A option 1) but wide; the mitigations
   are the existing `ValOpsHttp` tests plus the end-to-end auth checks in
   Verification. Instance-per-PAT (option 2) is the fallback if the threading
   turns out invasive — measure before choosing it for construction-cost
   reasons alone.
