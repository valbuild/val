# MCP support for Val — implementation plan

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

Authentication ships as **personal access tokens** (Stage 2), reusing the
`val login` device flow Val already has, with **OAuth 2.1** (Stage 3) as the
documented destination. Part D covers both and explains why Stage 2 is built so
as not to foreclose Stage 3. Local development needs no credential at all.

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

## Part D — authorization

Two stages. **Stage 2 is the shipping target**; Stage 3 is the destination and is
kept here so Stage 2 is not built in a way that forecloses it.

### D.0 The trust model as it stands today

This is the fact that determines the whole design:

> In proxy mode `ValOpsHttp` authenticates to content.val.build with an
> **app-level credential fixed at construction** — `VAL_API_KEY`
> (`ValOpsHttp.ts:200-205`) — and the end-user identity travels as a **plain
> `authorId` field in the request body** (`ValOpsHttp.ts:790-812`).

So the content backend verifies the _app_, then trusts whatever `authorId` the
app asserts. That is already true for the Studio: `ValServer` reads `auth.id` off
the verified `val_session` cookie and passes it as `authorId`. The cookie is not
something the backend sees — it is how the _app_ decides who to name.

Consequence: **the app is the authority on identity**, so whatever MCP presents
must be verifiable by the app, because the backend will not check it for us.

### D.1 Local (`fs`) mode: no credential at all

**Local MCP needs no PAT and no `val login`.** This is not an assumption — it
falls out of the tool set:

- `getAuth` is bypassed unconditionally in fs mode: every failure branch returns
  anonymous `{error: null, id: null}` when `serverOps instanceof ValOpsFS`
  (`ValServer.ts:224-264`).
- `validateRemoteFiles` is a **stub** — `// TODO: Implement`, returns `{}`
  (`ValOps.ts:1236-1243`), so validation never goes to the network.
- The PAT in `ValOpsFS` is used **only** by `getPresignedAuthNonce`
  (`ValOpsFS.ts:120-145`), the remote-file upload flow.

Every stage-1 tool operates on local content and touches none of that. Patches
land in `.val/patches` with `authorId: null`, as the Studio does locally. The
only fs-mode paths that reach for a PAT are remote file uploads — precisely the
image/session-key group deferred in Part B. The boundary lines up.

**Guard rail, non-negotiable:** because fs mode is unauthenticated by
construction, the template route must **refuse to serve when
`NODE_ENV === "production"` and no auth is configured**. Without that line a
deployed template is an open content-write endpoint.

### D.2 Stage 2 — personal access tokens (ship this)

Reuse the credential Val already issues. `val login` is an existing
browser-confirm device flow: `startValLogin` POSTs `{host}/api/login` and returns
a URL for the user to open; `awaitValLoginConfirmation` polls
`{host}/api/login?token=…&consume=true` and returns `{ profile: { email }, pat }`
(`login.ts:53-56`, `:110-172`); `persistPersonalAccessToken` writes
`.val/pat.json` at mode `0600` (`login.ts:179-201`).

Flow:

```
developer: val login                       → .val/pat.json           (exists today)
MCP client ──Authorization: Bearer <pat>──▶ /api/mcp
                                             ↓ resolve pat → profile id   ← ONE new backend endpoint
                                           registry (ctx.authorId) → ValOpsHttp → content.val.build
```

**The one thing that does not exist yet** is a way for the app to resolve a PAT
to a profile id. Val cannot verify a PAT locally — it only forwards it as
`x-val-pat` — and `getSettings` returns `{publicProjectId, remoteFileBuckets}`
with no identity (`getSettings.ts:5-9`). The `profile.email` in `.val/pat.json`
is written by the CLI at login and is self-asserted local data, so it cannot be
trusted by a server.

So Stage 2 needs **one addition to content.val.build**: resolve a PAT to a
profile (id, and ideally project membership). Either a small endpoint, or the
profile included in an existing authenticated response. This is the whole
backend cost of Stage 2, and it is work you own.

Val exports the verifier; the template calls it from `withMcpAuth`'s
`verifyToken`. **Cache resolutions** with a short TTL — otherwise every tool call
costs an upstream round trip, which is painful on serverless.

### D.3 Why not the session cookie

The obvious cheaper move is to accept the `val_session` JWT as a bearer token: it
is verifiable locally with `VAL_SECRET` (HMAC), and its `sub` is already the
author id, so it needs **no backend work at all**. Rejected, for three reasons:

1. **It conflates two lifecycles.** The session cookie is the human's Studio
   login. Reusing it as an agent credential means you cannot revoke the agent
   without logging the person out, or rotate a leaked agent token without
   invalidating browser sessions. A PAT is separately revocable.
2. **The JWT embeds a higher-value secret.** `IntegratedServerJwtPayload` carries
   `token` — the admin.val.build credential — alongside `sub`. MCP client configs
   are plaintext files on disk and are routinely committed by accident. A PAT is
   purpose-scoped; a session JWT is not.
3. **The UX is "copy it out of devtools."** `val login` already exists and is
   strictly better.

It would also require the D.5 fix first, since a pasted token that never expires
is materially worse than a cookie that at least has a client-side lifetime.

### D.4 Stage 3 — OAuth 2.1 (the destination)

Stage 2 is deliberately a stepping stone, not a detour: the resolve endpoint
becomes token introspection, the PAT becomes an access token, and `val login`
becomes the authorization flow.

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
  **Stage 2 does not have**: a PAT is project-wide, so a PAT leaked from one
  deployment works against any other. Accept that knowingly.
- **403 on insufficient scope.**

`mcp-handler` supplies all of it: `withMcpAuth(handler, verifyToken, {required,
requiredScopes, resourceMetadataPath})`, plus `protectedResourceHandler` and
`metadataCorsOptionsRequestHandler`.

Authorization-server requirements — ⚠️ **unverified, `valbuild/home` was not
readable when this was written; confirm before estimating**:

- **RFC 8414 metadata** at `/.well-known/oauth-authorization-server`.
- **OAuth 2.1**: authorization code with **PKCE `S256` mandatory**.
- **RFC 8707**: honour `resource` on authorization and token requests; set `aud`.
- **RFC 9207**: return `iss` in the authorization response. New in this revision.
- **Client registration**: current ordering is **Client ID Metadata Documents
  (CIMD) preferred → pre-registration → Dynamic Client Registration, which is
  deprecated**. DCR was the usual answer for MCP and is now the fallback.
- **Scopes**: at least `val:read` / `val:write`. Finer granularity is much harder
  to add later than now.
- **JWKS endpoint** — prefer JWT access tokens validated against JWKS over RFC
  7662 introspection, so the serverless route needs no per-request round trip.
- **Consent screen** naming the resource.

Promising starting point: the Studio already runs an OAuth-shaped flow —
`/authorize` → admin.val.build → `/callback` → `consumeCode`
(`ValServer.ts:170-208`, `:529-541`, `:603-640`). Not spec-compliant, but an
authorization endpoint, code exchange and consent surface plausibly exist.

**What Stage 2 does not give you, and only Stage 3 will:** third-party clients
that expect OAuth discovery (Claude Desktop's connector UI is OAuth-oriented),
scoped least privilege, and per-resource audience binding.

### D.5 Follow-on worth designing toward

Once the app holds a user token issued by Val's own AS, the `VAL_API_KEY` +
asserted-`authorId` arrangement in D.0 becomes unnecessary: content.val.build
could accept the **user's** token directly and derive the author itself, removing
the "app asserts identity" weakness for the Studio as well as MCP. Do not design
the AS in a way that forecloses this — allow content.val.build to be a second
registered resource.

### D.6 Prerequisite fix, separate PR

`decodeJwt` (`packages/server/src/jwt.ts:56-64`) parses the payload and returns
it **without ever checking `exp`**. Expiry is enforced only by the cookie's
client-side `expires` attribute, so a leaked or copied `val_session` token is
accepted by the server indefinitely. The signature comparison at `:50` is a plain
`!==` rather than constant-time.

Pre-existing, and it affects the Studio's cookie path regardless of which stage
you pick. **Fix it in its own PR** — changing `decodeJwt` changes login
behaviour and must not ride inside an MCP change.

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

  // Stage 2: `verifyValPat` resolves a PAT to a Val profile (cached).
  // Stage 3 swaps this for access-token validation and adds `requiredScopes`
  // plus `resourceMetadataPath` — the surrounding wiring does not change.
  const authHandler = withMcpAuth(handler, verifyValPat, {
    required: process.env.NODE_ENV === "production",
  });
  export { authHandler as GET, authHandler as POST };
  ```

- **`src/app/.well-known/oauth-protected-resource/route.ts`** — **Stage 3 only.**
  `protectedResourceHandler({ authServerUrls: ["https://admin.val.build"] })`
  plus `metadataCorsOptionsRequestHandler()` as `OPTIONS`. Not needed for
  Stage 2; listed here so the route's eventual home is settled.
- **`.env.example` + README** — the Val project vars, and how to attach the server:
  `claude mcp add --transport http val https://site.com/api/mcp --header "Authorization: Bearer $VAL_PAT"`.
  Note the header is right for Stage 2 but **wrong for Stage 3**: once the server
  advertises OAuth, a rejected `Authorization` header is reported as a failure
  rather than falling through to the OAuth flow, so the header must be dropped
  when Stage 3 lands. Document that in the README rather than discovering it.

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

1. **Read `valbuild/home`** and answer question 5 below — whether a PAT can be
   resolved to a profile, and what it would take to add. That single answer sizes
   Stage 2. The rest of the list does not depend on it.
2. Move shared helpers to `@valbuild/shared/internal` — separate commit, Studio
   tests green.
3. Registry skeleton + read-only tools + unit tests.
4. Write path (Part C) + write tools + tests.
5. `examples/next` MCP route; exercise locally with **no auth at all** (D.1).

   → **Steps 2–5 are the natural first PR**: a working local MCP server with no
   backend dependency whatsoever.

6. PAT resolution endpoint in `valbuild/home` (D.2) — the only backend work
   Stage 2 needs.
7. `verifyValPat` in `@valbuild/server`, wired through `withMcpAuth` in the
   template, with resolution caching.
8. Template wiring, README, changeset. **Ships here.**
9. `decodeJwt` `exp` fix — separate PR (D.6). Independent of MCP; do it whenever,
   but it becomes a prerequisite if you ever reconsider D.3.
10. Stage 3 (D.4), when third-party OAuth clients or scoped access justify it.

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

**Blocking for Stage 2 — answer first:**

1. **Can a PAT be resolved to a profile id?** Today there is no way: `getSettings`
   returns only `{publicProjectId, remoteFileBuckets}` (`getSettings.ts:5-9`), and
   the `profile.email` in `.val/pat.json` is written by the CLI at login
   (`login.ts:54`), so a server cannot trust it. Either a small resolve endpoint
   or the profile added to an existing authenticated response. **This is the one
   thing Stage 2 needs that does not exist.**
2. Are PATs revocable per-token, and is there a listing UI? Separate revocation is
   the main reason D.3 rejects the session cookie — it should actually hold.
3. Does the content API validate that `authorId` is a real project member, or
   accept any string? Determines how much the app's own auth must carry.

**For Stage 3, later:**

4. How far is the existing `/authorize` → `consumeCode` flow from OAuth 2.1 + PKCE?
5. Is there token/JWKS infrastructure, or would signed access tokens be new?
6. What scope granularity does the permission model already support?
7. Can content.val.build accept a user token directly, per D.5?

---

## Risks

1. **The one backend dependency is PAT→profile resolution** (open question 1),
   in a repo this plan could not read. Steps 2–5 are deliberately independent of
   it, so an unexpected answer delays shipping but does not stall the work.
2. **Two tool definition sets will drift** (Studio's and MCP's). Accepted for now;
   identical names keep convergence cheap.
3. **Concurrent writes** — MCP callers and Studio users share the patch chain.
   `patch-head-conflict` plus one retry is the plan; whether that suffices under a
   long agent run is untested.
4. **Moving helpers touches the live chat path** (`useAI.ts` imports). Hence the
   separate commit.
5. **Stage 2 has no audience binding.** A PAT is project-wide, so one leaked from
   a deployment works against any other deployment of the same project. Stage 3's
   RFC 8707 `aud` is what fixes it. Accept knowingly, and keep it in mind when
   deciding how widely PATs get handed out.
6. **Claude Desktop's connector UI is OAuth-oriented**, so a static bearer header
   may not be configurable there — Stage 2 likely reaches it only via the
   `mcp-remote` stdio bridge. Claude Code and Cursor take the header directly.
   Test the three separately; they do not behave identically. If Claude Desktop
   is a hard requirement, that alone argues for going straight to Stage 3.
