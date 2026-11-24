---
"@valbuild/server": patch
"@valbuild/tanstack": patch
"@valbuild/next": patch
"@valbuild/mcp": patch
---

**A published page no longer loads the Studio, TypeScript, sucrase or prettier.** A site's first request in a fresh server process (on Val's hosting, every request a cold isolate answers) used to evaluate all of Val's server: the Studio's embedded assets (about 22 MB), TypeScript (9 MB), sucrase and the MCP tools. A page only needs that when someone edits it. These now load when they are first used, by the Val API, a draft read, a save or an MCP call, and a visitor's page never loads them.

We measured this in a fresh Node process, with the TanStack example app built the way a deployed app is built and running as a deployed site does (`http` mode). The first request for a public page used to load 38.8 MB of modules, take about 1.06 s and leave 170 MB of heap in use. It now loads 5.3 MB, takes about 0.23 s and leaves 38 MB of heap. An isolate counts more than Node does, so treat these heap figures as a lower bound.

What changed for an app:

- `initValContent` (and `initValRsc` in `@valbuild/next`) no longer start Val's server when they are created. They start it on the first draft read.
- With TanStack Start, `initValServer` loads the server on its first request in `http` mode, which is what a deployed site runs in. In local development (`fs` mode) and memory mode it still starts with the app. Those modes need the newest build in a process to exist before the previous build answers a request.
- `initValMcp` from `@valbuild/tanstack/server` loads the MCP tools on the first MCP request. Its `valMcpMetadata` comes from the new `@valbuild/mcp/metadata` entry, which is small.
- `createPrettierFormatter` now also accepts a loader. **Update your `val.server.ts`** so prettier is loaded by the first save rather than by every page:

  ```ts
  // before
  import prettier from "prettier";
  formatter: createPrettierFormatter(prettier, { projectRoot: process.cwd() }),

  // after
  formatter: createPrettierFormatter(() => import("prettier"), {
    projectRoot: process.cwd(),
  }),
  ```

  Passing `prettier` itself still works.

- If your app serves MCP from a TanStack Start route, import the MCP SDK inside the handler (`await import("@modelcontextprotocol/server")`), not at the top of the file. TanStack Start's route tree imports every server route's module on every cold start.
