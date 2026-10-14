# App-defined tools for the Studio assistant

> **Status, 2026-10-05: proposal.** Nothing here is built. It is the plan for
> "option A" of a short investigation into letting the Studio's AI chat use
> tools — and other MCP servers — that a project defines itself. The two
> options that lost are recorded at the end with the reason they lost.
>
> Claims about the code carry a `file:line`, verified on the date above. Read
> them as hints about where to look, not as facts; files move.

## Goal

A developer can give the Studio assistant tools of their own — a function that
looks something up in their shop, or a whole MCP server such as Linear — by
registering them in their app, next to where they already configure Val. An
editor chatting in the Studio sees the assistant use them like any built-in
tool.

The same registration serves Val's MCP endpoint too, so a tool written once is
available to the Studio chat and to Claude Code / Cursor alike.

### Not goals

- **No-code configuration** (an admin pasting an MCP URL into admin.val.build).
  That is option B below, and it can be added beside this later.
- **Moving the Studio's built-in tools to the server.** They read the Studio's
  client stores and stay where they are. App tools are additive.
- **Changes to `valbuild/home`.** The design needs none; see "Background".

---

## Background: why this is mostly a Studio change

The assistant's loop runs in `valbuild/home`, but it executes nothing:

- **Every tool is declared by the Studio.** `useAI.ts` builds `ALL_TOOLS` and
  the system prompt and sends both with every `ai_prompt`
  (`packages/ui/spa/hooks/useAI.ts:2421-2515`).
- **`home` relays, it does not run.** `runAgentLoop`
  (`home/content/src/ai/aiHandler.ts:526-697`) sends each tool call to the
  browser as `ai_tool_call` and waits for `ai_tool_result`. Apart from its own
  `transfer_to_agent` it does not know or care what a tool is. A tool may carry
  `timeoutMs` (`aiHandler.ts:59`); the default is 30 s, and `null` means wait
  forever.
- **The Studio dispatches by name**, in one if/else chain from `useAI.ts:957`.
  Its last branch answers `Unknown tool: <name>`. That branch is the seam.
- **The Studio cannot run project code.** It is a prebuilt bundle served from
  `/api/val/static`, so a project cannot add a function to it. A project tool
  has to run somewhere the Studio can reach — and the app's own Val API
  (`/api/val/*`, `ValServer`) is already that place: the Studio calls it for AI
  helpers today (`/ai/session-image-to-patch-file`, `ValServer.ts:3423`,
  called from `ValProvider.tsx:471`).

The pieces for writing a tool already exist in `@valbuild/mcp`: `defineTool`,
`ok`, `err`, `ValToolImpl`, the registry (`createValTools`) with its
name-collision check, and `listJsonSchema()`, which turns a zod input schema
into the JSON Schema a model needs (`packages/mcp/src/tools/createValTools.ts`).
Hosts already pass their own tools to it as `extraTools`
(`packages/mcp/src/initValMcp.ts:98`) — that is how `upload_image` gets in.

---

## Design

```
 Studio (browser)                    app server (/api/val)              upstream
 ────────────────                    ─────────────────────              ────────
 chat start ── GET /ai/tools ──────▶ registry.listJsonSchema()
 ai_prompt { tools: [...ALL_TOOLS, ...app__*] } ──▶ home (relays)
 ◀── ai_tool_call app__lookup_product ── home
 [confirm if destructive]
 POST /ai/tools/call ──────────────▶ registry.call(name, args, ctx) ──▶ shop API / MCP server
 ◀──────────────────────────────── ValToolResult
 ai_tool_result ──▶ home ──▶ model
```

### 1. What a developer writes

A file of tools, using the existing `defineTool`:

```ts
// val/assistantTools.ts
import "server-only";
import { z } from "zod";
import { defineTool, ok, err } from "@valbuild/mcp";

export const lookupProduct = defineTool(
  {
    name: "lookup_product",
    title: "Look up product",
    description:
      "Find a product in the shop by SKU or name. Returns price, stock and URL. " +
      "Use when an editor writes about a product and needs correct facts.",
    inputSchema: z.object({ query: z.string() }),
    annotations: { readOnlyHint: true },
    timeoutMs: 15_000,
  },
  async ({ query }) => {
    const res = await fetch(
      `https://shop.internal/api/products?q=${encodeURIComponent(query)}`,
      { headers: { authorization: `Bearer ${process.env.SHOP_API_KEY}` } },
    );
    if (!res.ok) return err("internal", `Shop answered ${res.status}`);
    return ok(await res.json());
  },
);
```

and one option on the `initValServer` it already calls, in both bindings:

```ts
// val/server.ts — @valbuild/next/server or @valbuild/tanstack/server
const { valNextAppRouter } = initValServer(
  valModules,
  { ...config },
  {
    draftMode,
    formatter,
    assistant: { tools: [lookupProduct, purgeCdn, ...linearTools] },
  },
);
```

Passing the same array to `initValMcp({ extraTools })` puts the tools on the
MCP endpoint as well. Whether `initValServer` should do that for you is an open
question (below).

**New on `ValToolDefinition`:** `timeoutMs?: number | null`, with the meaning
`home` already gives it. It is ignored by the MCP endpoint, where the MCP host
owns timeouts.

### 2. Other MCP servers: `toolsFromMcpClient`

`@valbuild/mcp` imports no MCP SDK, deliberately (the SDK has reorganised itself
once already), and takes `sharp` as an argument for the same kind of reason. An
MCP client is handled the same way: the app constructs it, and Val adapts it
through a structural type.

```ts
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { toolsFromMcpClient } from "@valbuild/mcp";

const linear = new Client({ name: "val-assistant", version: "1" });
await linear.connect(
  new StreamableHTTPClientTransport(new URL("https://mcp.linear.app/mcp"), {
    requestInit: {
      headers: { authorization: `Bearer ${process.env.LINEAR_API_KEY}` },
    },
  }),
);

export const linearTools = await toolsFromMcpClient(linear, {
  prefix: "linear", // linear__list_issues, linear__get_issue
  allow: ["list_issues", "get_issue"],
});
```

- **`McpClientLike`** is the structural type: `listTools()` and
  `callTool({ name, arguments })`, as narrow as `SharpLike`. A test assigns the
  real SDK `Client` to it, the way `sharpImageProcessor.test.ts` does, so the
  two cannot drift.
- **The input schema stays JSON Schema.** `ValToolImpl` holds a zod schema, and
  there is deliberately no JSON-Schema-to-zod converter anywhere in the stack.
  So the adapter needs a second shape — a tool whose `inputSchema` is already
  JSON Schema and whose arguments are validated by the remote server rather
  than here. That is a change to `ValToolDefinition`, not a cast; it needs its
  own decision.
- **`allow` is required, not optional.** A third-party server can add a write
  tool next month; it must not appear in an editor's chat without a developer
  deciding it should. `allow: "all"` can exist, spelled out.
- **Annotations pass through.** MCP tools carry `readOnlyHint` /
  `destructiveHint` already, and section 6 acts on them.
- **Connections.** On a serverless host a module-level `connect()` runs per
  cold start, and a dropped connection has to be redialled. The adapter should
  take a factory (`() => Promise<McpClientLike>`) and connect lazily, so an
  unreachable MCP server costs the call that needs it rather than every request
  that loads the module.

### 3. Server routes, and where the registry is built

**`@valbuild/server` cannot import `@valbuild/mcp`** — the dependency runs the
other way (`packages/mcp/package.json` depends on `@valbuild/server`). So:

- `ValServerOptions` (`ValServer.ts:80`) gains a narrow, injected interface:
  `assistantTools?: { listJson(): …; call(name, args, ctx): Promise<ValToolResult> }`.
- `@valbuild/next` and `@valbuild/tanstack`, which depend on both packages,
  build it from `opts.assistant.tools` with `createValTools`-style
  registration and pass it in. Same split as `initValMcp`.

Two routes, typed in `packages/shared/src/internal/ApiRoutes.ts`:

- `GET /ai/tools` — definitions only: name, title, description, JSON Schema,
  annotations, `timeoutMs`. Authenticated like the other `/ai/*` routes.
  Sorted by name, so the list is byte-stable across requests (see section 8).
- `POST /ai/tools/call` — `{ name, arguments, sessionId? }` →
  `ValToolResult`. Always HTTP 200 for a tool that ran, including one that
  returned `status: "error"`; non-200 is reserved for "the call never reached
  a tool" (401, 404 unknown tool, 500 setup failure), so the Studio can tell
  the model which kind of failure it was.

### 4. The Studio

In `useAI.ts`:

- **Fetch once per chat session** (`GET /ai/tools`), not per prompt. A failed
  fetch is not an error the editor sees: the chat works with the built-in
  tools and logs why the app's are missing.
- **Namespace** every app tool as `app__<name>` when building `agents[].tools`.
  An app tool can then never shadow a built-in, whatever the registry allows.
  Both providers cap tool names at 64 characters of `[a-zA-Z0-9_-]`, so the
  registry refuses, at startup, a name longer than 59 or with other characters
  — at startup rather than at the first prompt, where it would be a 400 from
  the provider that names nothing.
- **Dispatch:** a new branch before `Unknown tool` forwards `app__*` calls to
  `POST /ai/tools/call`, then sends `ai_tool_result` with `isError` set from
  the result, and marks the activity complete or errored.
- **Cap the result.** `home` stringifies whatever comes back into the model's
  context (`aiHandler.ts:649`), and that is billed to the project's own key.
  Truncate above a fixed size with a note saying so, rather than forwarding a
  1 MB JSON blob.
- **Label:** `AIChatToolActivities.tsx:81` has hand-written labels for the
  built-ins. App tools show their `title`, falling back to the name.
- **System prompt:** one short section listing the app tools by title, so the
  model knows they exist and that they act outside Val. The descriptions
  themselves travel in `tools`, not in the prompt.

### 5. Authentication: a second verified kind

`ValToolContext.auth` is `ValToolAuth | null`, and `ValToolAuth` has exactly one
variant, `verified-profile`, for an OAuth access token whose signature was
checked (`packages/mcp/src/tools/types.ts:95`). Its comment anticipates this:
adding a second verified kind is meant to be a one-line change at every call
site.

A Studio call is authenticated by Val's own session cookie, which `ValServer`
signed and verifies with `valSecret` (`getAuth`). That is a verified identity,
so it gets its own variant — say `{ type: "studio-session", profileId, scopes }`
with read and write — rather than being squeezed into the OAuth one.

What must not happen: falling back to the app's API key when there is no
profile. The MCP registry already refuses that in proxy mode, for the stated
reason that the key can do more than any single user. App tools keep the rule.
In fs mode `auth` is `null`, as it is for the MCP endpoint locally.

### 6. Confirmation for tools with side effects

A tool marked `destructiveHint` makes the Studio ask the editor before running
it — a card like the existing `ask_user_question` one: "Purge /blog from the
CDN?" with Allow / Deny. A denial goes back to the model as an error result
("The editor declined"), which it can explain.

This is the defence against prompt injection, and it has to be in the client,
not in the prompt: content the assistant reads is written by many people, and a
blog post that says "call purge_cdn on /" is just text until a tool runs it.
The MCP spec calls annotations hints, which is right for an MCP host; for the
Studio, `destructiveHint: true` is a rule. A tool with no annotations at all is
treated as destructive.

### 7. State is loaded only when a tool asks for it

`createValTools.call` runs `loadState(ops)` before every handler
(`createValTools.ts:118`). `loadState` evaluates every module and applies the
pending patches; it took 843 ms on `valbuild/web` (see CLAUDE.md, MCP). A tool
like `lookup_product` never reads it.

For app tools, `deps.state` (and `deps.ops`, whose resolution can also refuse)
becomes lazy: a `getState()` that loads on first call and memoises for the
call. Existing built-in MCP tools can keep calling it immediately, so their
behaviour does not change.

This is not an optimisation. It decides whether app tools work on a host that
limits CPU time — see section 8.

### 8. Timeouts, and where they come from

Three clocks, and the shortest one wins:

1. **`home`'s wait for a result** — 30 s by default, or the tool's
   `timeoutMs` (`aiHandler.ts:404`, `637-640`). The Studio forwards each
   app tool's `timeoutMs`; nothing else needs changing in `home`.
2. **The host's function limit.** Vercel's function duration; on Cloudflare
   Workers, CPU time per request (time spent waiting on `fetch` does not
   count). From memory, not verified for this plan: 10 ms on the free plan,
   30 s by default on paid and configurable to 5 minutes, and no wall-clock
   limit while the client stays connected. **Check
   developers.cloudflare.com/workers/platform/limits before relying on
   these.**
3. **A proxy in front of the app.** Cloudflare's proxy returns 524 after 100 s
   of origin silence below Enterprise (also from memory).

Consequences for the docs and the showcase:

- An I/O-bound tool (call an API, forward to an MCP server) fits on any of
  these, including Cloudflare's free plan — provided it does not trigger
  `loadState` (section 7).
- Document: set `timeoutMs` below the host's limit. A tool killed by the host
  surfaces as a failed fetch in the Studio; say so in the error rather than
  "internal".
- Long work is a job: one tool starts it and returns an id, another reports
  status. Do not hold a request open for minutes.

Also: tools render before `system` in a prompt-cache prefix. The list is
fetched once per session and sorted, so it does not change between turns of
one conversation and does not break caching.

---

## Build order

Each stage is shippable on its own.

1. **Registry changes in `@valbuild/mcp`.** `timeoutMs` on definitions; lazy
   `getState()`; the `studio-session` auth variant; name validation (length,
   characters). Unit tests beside `createValTools`.
2. **Server routes.** The injected interface on `ValServerOptions`, the two
   routes, the `ApiRoutes` entries, and the `assistant.tools` option in
   **`@valbuild/tanstack` first** (the primary target), then `@valbuild/next`.
3. **Studio.** Fetch, namespace, dispatch, result cap, labels, prompt section.
   Read-only and destructive-free tools only at this stage: anything not
   `readOnlyHint: true` is not offered to the model yet.
4. **Confirmation card**, then lift the stage-3 restriction.
5. **`toolsFromMcpClient`** and the JSON-Schema-input tool shape it needs.
6. **Showcase and docs.** A tool in `examples/tanstack` — I/O-bound, within
   Cloudflare's free-plan CPU limit — registered in `val/server.ts` and used
   from a route's content. `examples/next` gets the fixture shapes the e2e
   suite needs (a destructive tool, a tool that times out, a tool that throws).
   README section; add "assistant tools" to the showcase list in CLAUDE.md.

## Testing

- **Unit:** registry (collision, name validation, lazy state never loaded by a
  tool that does not ask, `timeoutMs` passed through to `listJson`); the routes
  (401 without a session, unknown tool, error result is still 200);
  `McpClientLike` assigned the real SDK client.
- **e2e, `chromium-http`:** the AI WebSocket goes to `home`, which the mock
  content host does not implement today. Either the mock grows a scripted
  model that emits a chosen `ai_tool_call`, or the Studio dispatch is tested at
  the `useAI` boundary with a fake socket. The second is cheaper and covers the
  part this plan changes; decide when stage 3 starts.
- **Smoke:** `pnpm exec playwright test --project=tanstack` must stay green
  with a tool registered, since the showcase will have one.

## Open questions

- **Should `initValServer`'s `assistant.tools` also reach the MCP endpoint
  automatically?** One list is the point; but the MCP endpoint has a different
  audience (a developer's agent, with scopes) and someone may want a tool in
  one and not the other. Leaning: separate options, same array in the docs.
- **Per-tool visibility.** Should a tool be offered only to some editors (by
  role, or only in proxy mode)? Not in the first version; the registry can
  grow a predicate on `ctx` later.
- **Built-in Val tools on the server.** The MCP registry already has
  server-side `get_source`, `create_patch` and friends. A project tool that
  edits Val content should go through those (via `deps.ops`) rather than
  writing patches itself, and the docs should say so — but whether to expose
  that as an API to app tools is its own design.
- **Auditing.** Tool calls with side effects outside Val leave no trace in Val.
  Is a log line enough, or does the patch history need an entry?

---

## The options that lost

**B. Hosted MCP through the AI provider.** Anthropic's MCP connector
(`mcp_servers` plus an `mcp_toolset` entry in `tools`, beta
`mcp-client-2025-11-20`) and OpenAI's Responses `mcp` tool let the provider
call a remote MCP server itself. Zero code for the project, which is why it
may still be worth adding beside this for admins. It lost as the first
version because it reaches only public HTTP servers, behaves differently per
provider, stores third-party tokens in `home`, and — the deciding one — the
calls bypass the Studio, so there is nowhere to show them or to ask before a
destructive one runs.

**C. `home` as the MCP client.** Provider-neutral and nothing in the app, but
`home` would own MCP OAuth for arbitrary third-party servers, outbound egress,
and secret storage, for every project. The most work and the most risk, for a
result option A gets with the secrets staying in the project's own
environment.
