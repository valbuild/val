# MCP support for Val — implementation plan (OAuth 2.1)

> **How to use this document.** It is written to be self-contained: paste it into
> a fresh session that has `valbuild/val`, `valbuild/template-nextjs-starter` and
> `valbuild/home` attached. Nothing here assumes context from the session that
> produced it.
>
> Every claim about `valbuild/val` and `valbuild/template-nextjs-starter` was
> verified against the code on 2026-08-30 and carries a `file:line`. Claims about
> the MCP spec and npm packages were verified the same day against the raw
> published sources. **Nothing here was verified against `valbuild/home`** — that
> repo was not reachable in the originating session. Part D is therefore written
> as _requirements plus questions_, and the first task in the order of work is to
> read that repo and correct Part D against reality.

---

## Goal

Make Val content editable from any MCP client (Claude Code, Cursor, custom
agents), with **Val exposing the tools and the auth** and **the template defining
the actual MCP server**, so other MCP hosts can consume the same tools.

Authentication is **OAuth 2.1** per the MCP authorization spec, with
admin.val.build as the authorization server. This is deliberately the full
version, not a static-token shortcut.

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
    ↓
@valbuild/server/tools        ← NEW. Transport-agnostic registry. No MCP SDK.
  createValTools(...) → { list(), listJsonSchema(), call(name, args, ctx) }
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
  /** The authenticated Val profile id, or null in local fs mode. */
  authorId: AuthorId | null;
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
  Part D.
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

## Part D — authorization (OAuth 2.1)

### D.0 The trust model as it stands today

This is the fact that determines the whole design:

> In proxy mode `ValOpsHttp` authenticates to content.val.build with an
> **app-level credential fixed at construction** — `VAL_API_KEY`
> (`ValOpsHttp.ts:200-205`) — and the end-user identity travels as a **plain
> `authorId` field in the request body** (`ValOpsHttp.ts:790-812`).

So the content backend verifies the _app_, and then trusts whatever `authorId`
the app asserts. That is already true for the Studio: `ValServer` reads `auth.id`
off the verified `val_session` cookie and passes it as `authorId`. The cookie is
not something the backend sees — it is how the _app_ decides who to name.

Two consequences:

- **The app is the authority on identity.** Whatever we do for MCP has to be
  verifiable _locally_ by the app, because the backend will not check it for us.
- OAuth 2.1 gives the app, for the first time, a cryptographic proof of who the
  caller is — issued by the same organisation that owns the backend. See D.5 for
  where that leads.

### D.1 Local (`fs`) mode: no credential at all

**Local MCP needs no PAT and no `val login`.** This is not a simplification taken
on faith — it falls out of the tool set:

- `getAuth` is bypassed unconditionally in fs mode: every failure branch returns
  anonymous `{error: null, id: null}` when `serverOps instanceof ValOpsFS`
  (`ValServer.ts:224-264`).
- `validateRemoteFiles` is a **stub** — `// TODO: Implement`, returns `{}`
  (`ValOps.ts:1236-1243`), so validation never goes to the network.
- The PAT in `ValOpsFS` is used **only** by `getPresignedAuthNonce`
  (`ValOpsFS.ts:120-145`), the remote-file upload flow.

Every stage-1 tool operates on local content and touches none of that. Patches
land in `.val/patches` with `authorId: null`, exactly as the Studio does locally.
The only fs-mode paths that reach for a PAT are remote file uploads — precisely
the image/session-key group deferred in Part B. The boundary lines up.

**Guard rail, non-negotiable:** because fs mode is unauthenticated by
construction, the template route must **refuse to serve when
`NODE_ENV === "production"` and no OAuth configuration is present**. Without that
line a deployed template is an open content-write endpoint.

### D.2 The OAuth roles

```
MCP client ──(1) no token──▶ /api/mcp                         [Resource Server]
           ◀─(2) 401 + WWW-Authenticate: resource_metadata=…
           ──(3) GET /.well-known/oauth-protected-resource──▶
           ──(4) GET /.well-known/oauth-authorization-server─▶ admin.val.build  [AS]
           ──(5) authorization code + PKCE, resource=…───────▶ (user consents)
           ◀─(6) access token, aud = https://site.com/api/mcp
           ──(7) Bearer <token>──────────────────────────────▶ /api/mcp
                                                                 ↓ validate, map sub → authorId
                                                              registry → ValOpsHttp → content.val.build
```

- **Resource Server** = the Next app's `/api/mcp` route (in the template).
- **Authorization Server** = admin.val.build (`valbuild/home`).
- **Resource identifier** = the MCP endpoint URL, e.g. `https://site.com/api/mcp`.

### D.3 What the Resource Server must do

Spec obligations (MCP authorization spec, revision 2026-07-28):

- Serve **RFC 9728 Protected Resource Metadata** at
  `/.well-known/oauth-protected-resource`. The spec is `MUST` for servers, and
  clients `MUST` use it for AS discovery.
- Answer unauthenticated requests with **401 + `WWW-Authenticate`**, and `SHOULD`
  include `scope`:
  `Bearer resource_metadata="https://site.com/.well-known/oauth-protected-resource", scope="val:read val:write"`
- **Validate the token**: signature, `iss`, `exp`, and **audience per RFC 8707** —
  `aud` must match this resource. Audience validation is what stops a token minted
  for another Val site being replayed here.
- **403 on insufficient scope.**

`mcp-handler` provides all of this: `withMcpAuth(handler, verifyToken, {required,
requiredScopes, resourceMetadataPath})`, plus `protectedResourceHandler` and
`metadataCorsOptionsRequestHandler` for the metadata route.

**Token validation strategy — pick JWT + JWKS.** Two options:

- **(A) JWT access tokens, validated against the AS's JWKS.** Stateless, no
  network per request once JWKS is cached. Correct for serverless, where the
  route is cold and per-request round trips hurt. Use `jose`.
- (B) RFC 7662 token introspection — a call to the AS per request. Simpler for the
  AS (opaque tokens) but adds latency to every tool call.

Recommend **(A)**, with the AS publishing JWKS. Revocation latency is the tradeoff;
keep access-token lifetimes short and lean on refresh tokens.

The access token's `sub` **is** the Val profile id, and becomes `ctx.authorId`.

### D.4 What the Authorization Server must provide

⚠️ **Unverified — `valbuild/home` was not readable when this was written. Confirm
all of this before estimating.**

Requirements:

- **RFC 8414 metadata** at `/.well-known/oauth-authorization-server`.
- **OAuth 2.1**: authorization code flow with **PKCE `S256` mandatory**
  (`code_challenge_methods_supported: ["S256"]`).
- **RFC 8707 resource indicators**: honour the `resource` parameter on both
  authorization and token requests, and set `aud` on the issued token accordingly.
- **RFC 9207**: return `iss` in the authorization response. New in the 2026-07-28
  revision — clients `MUST` record the issuer from validated AS metadata and
  validate it before sending the code to any token endpoint.
- **Client registration**: the spec's current ordering is **Client ID Metadata
  Documents (CIMD) preferred → pre-registration → Dynamic Client Registration,
  which is deprecated** and retained only for backwards compatibility. Advertise
  CIMD via `client_id_metadata_document_supported`. This matters: DCR was the
  usual answer for MCP and is now the fallback, not the target.
- **Scopes**: define at least `val:read` and `val:write`. Finer granularity (per
  project, per module path) is worth considering while the surface is new — it is
  much harder to tighten later.
- **JWKS endpoint**, if strategy (A).
- **Consent screen** naming the resource, so a user can tell which site is asking.

**Promising starting point:** Val already has an OAuth-shaped flow. The Studio
does `/authorize` → admin.val.build → `/callback` → `consumeCode`
(`ValServer.ts:170-208`, `:529-541`, `:603-640`), exchanging a code using
`VAL_API_KEY` as bearer and minting the session JWT. That is not spec-compliant
OAuth 2.1, but it means an authorization endpoint, a code exchange and a consent
surface plausibly already exist. **Task one is to read `valbuild/home` and
establish how far the existing flow is from the requirements above.**

### D.5 The follow-on worth designing toward

Once the app holds a user access token issued by Val's own AS, the
`VAL_API_KEY` + asserted-`authorId` arrangement in D.0 becomes unnecessary:
content.val.build could accept the **user's** access token directly and derive the
author itself. That removes the "app asserts identity" weakness for the Studio as
well as MCP. Out of scope here, but do not design the AS in a way that forecloses
it — in particular, allow content.val.build to be a second registered resource.

### D.6 Prerequisite fix, separate PR

`decodeJwt` (`packages/server/src/jwt.ts:56-64`) parses the payload and returns it
**without ever checking `exp`**. Expiry is enforced only by the cookie's
client-side `expires` attribute, so a leaked or copied `val_session` token is
accepted by the server indefinitely. The signature comparison at `:50` is also a
plain `!==` rather than constant-time.

This is pre-existing and affects the Studio's cookie path, not just MCP. **Fix it
in its own PR** — changing `decodeJwt` changes login behaviour and must not ride
inside an MCP change.

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
              authorId: ctx.http?.authInfo?.extra?.profileId ?? null,
              sessionId: null,
            }),
          ),
      );
    }
  });

  const authHandler = withMcpAuth(handler, verifyValAccessToken, {
    required: process.env.NODE_ENV === "production",
    requiredScopes: ["val:read"],
    resourceMetadataPath: "/.well-known/oauth-protected-resource",
  });
  export { authHandler as GET, authHandler as POST };
  ```

- **`src/app/.well-known/oauth-protected-resource/route.ts`** —
  `protectedResourceHandler({ authServerUrls: ["https://admin.val.build"] })`
  plus `metadataCorsOptionsRequestHandler()` as `OPTIONS`.
- **`.env.example` + README** — the Val project vars, and how to attach the server:
  `claude mcp add --transport http val https://site.com/api/mcp`. With OAuth the
  client runs the flow itself; **do not** pass an `Authorization` header, because
  a rejected header is reported as failure rather than falling through to OAuth.

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
  `originValidationResponse` guards when not behind `mcp-handler`.

---

## Order of work

1. **Read `valbuild/home`** and correct Part D against what the AS actually is
   today. Everything else is independent of the answer, so it need not block.
2. `decodeJwt` `exp` fix — separate PR (D.6).
3. Move shared helpers to `@valbuild/shared/internal` — separate commit, Studio
   tests green.
4. Registry skeleton + read-only tools + unit tests.
5. Write path (Part C) + write tools + tests.
6. `examples/next` MCP route; exercise locally with no auth (D.1).
7. AS work in `valbuild/home` (D.4) — the long pole; parallelise from step 1.
8. Resource-server auth in the template (D.3) + metadata route.
9. Template wiring, README, changeset.

Steps 2–6 deliver a working local MCP server with no dependency on the AS. That
is the natural first PR.

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

For the OAuth path, verify the 401 challenge, the two metadata documents, and that
a token minted for a _different_ resource is rejected by audience validation.

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

## Open questions for `valbuild/home`

1. What is admin.val.build's existing auth stack, and how far is the
   `/authorize` → `consumeCode` flow from OAuth 2.1 + PKCE?
2. Is there existing token/JWKS infrastructure, or would signed access tokens be
   new?
3. Does the content API validate that `authorId` is a real project member, or
   accept any string? (Determines how much the app's own auth must carry.)
4. Can content.val.build accept a user access token directly, per D.5?
5. Is there a PAT → profile resolution endpoint? `getSettings` returns only
   `{publicProjectId, remoteFileBuckets}` (`getSettings.ts:5-9`), and `val login`
   stores a self-asserted `profile.email` in `.val/pat.json` (`login.ts:54`), so
   there is currently no way for the app to learn identity from a PAT.
6. What scope granularity does the backend's permission model already support?

---

## Risks

1. **The AS is the long pole**, and it is in a repo this plan could not read.
   Steps 2–6 are deliberately independent of it.
2. **Two tool definition sets will drift** (Studio's and MCP's). Accepted for now;
   identical names keep convergence cheap.
3. **Concurrent writes** — MCP callers and Studio users share the patch chain.
   `patch-head-conflict` plus one retry is the plan; whether that suffices under a
   long agent run is untested.
4. **Moving helpers touches the live chat path** (`useAI.ts` imports). Hence the
   separate commit.
5. **Claude Desktop's connector UI** is OAuth-oriented; that is an argument _for_
   this stage, but the flow should be tested against Claude Code, Cursor and
   Claude Desktop separately — they do not behave identically.
