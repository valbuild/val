# Val Start — running Val inside the browser-built platform

A living document. It is written so the work can be **rebuilt from it** rather
than archaeologically recovered from commits: the goal, the decisions and why
they were taken, what has actually been proven, and what is still guesswork.

Keep it current as the work moves. When something here turns out to be wrong,
correct it in place and say so — a stale line here is worse than no line.

**Status: Val's server runs in the isolate and the Studio reads the real
project. Nothing has been edited yet.** Nothing here is a design Val should
adopt yet.

---

## 1. The goal

Val Studio running *inside* the browser-built platform
(`freekh/experiment-browser-built-tanstack-start`), where:

- the Studio can be used to create patches, and
- the **real built site changes** as a result.

The publish step does **not** have to create a git commit or move a URL. It has
to be demonstrably possible — the evidence matters, the ceremony does not.

## 2. The platform, in one paragraph

Apps are built in a browser tab (rolldown/wasm) and published as two KV writes
plus a pointer flip; a Cloudflare Dynamic Worker loads the result from a module
map. Dependencies never change at publish time — they are built once, natively,
into immutable **vendor chunks**, and the browser build treats every one as an
external. A project's own dependencies are a **project vendor layer**, built
ahead of publish, and every import a chunk emits is **audited**: it must resolve
into the base layer, a sibling chunk, or a Node builtin the runtime provides.
Anything else would be an unresolvable bare specifier at isolate startup.

That audit is why "just import `@valbuild/server`" is not a thing you can do.

## 3. What is already proven

- **The site half of the Val starter template runs.** Server-rendered with its
  Val content and Tailwind, hydrating with no JS errors.
  One Val change is needed: `@valbuild/tanstack`'s root entry reaches
  `@tanstack/react-start/server` inside `isValEnabled` (`initVal.ts`), which
  drags `node:stream/web` in through router-core's SSR path. Val already wraps
  it in `await import()` for exactly this reason; that works under Vite but not
  here, because the vendor layer bundles ahead of publish and audits every chunk
  it emits — a dynamically imported chunk is still a chunk.
  Fix: move `isValEnabled` to `@valbuild/tanstack/server`, or give the root
  export a `"browser"` condition.
- **Val Studio's UI loads and runs in the isolate.** The SPA is base64-embedded
  into `@valbuild/ui/server` by `packages/ui/fix-server-hack.js`, and
  `createUIRequestHandler` reads it back with **zero node builtins**. Serving
  `/api/val/static/*` from the isolate is enough to make the editor open.
- **A local Val checkout can be tested without releasing.** `pnpm build` (~50s),
  then the platform's playground re-points `@valbuild/*` at the checkout.
  Caveat: `npx preconstruct build` alone (~40s) does **not** run the UI build,
  so it wipes the embedded SPA — use the full `pnpm build` for UI changes.

## 4. What Val's server half actually costs

Measured by bundling `@valbuild/tanstack/server` for a browser target with the
platform's base layer externalised:

```
bundled  16.22 MB across 5 chunks
node builtins required (16): crypto, fs, fs/promises, http, https, inspector,
  node:crypto, node:fs/promises, node:module, node:path, node:stream,
  node:stream/web, os, path, perf_hooks, worker_threads

  8.72 MB  typescript
  7.15 MB  @valbuild/ui
  0.79 MB  zod
  0.56 MB  @valbuild/server
  0.45 MB  sucrase
  0.43 MB  @valbuild/core
  0.18 MB  @valbuild/mcp
```

**Val's own logic is ~1.2 MB.** The other 15 MB is the TypeScript compiler and
the embedded Studio bundle. TypeScript is not incidental: content is `.val.ts`
source, so applying a patch means rewriting a TypeScript AST
(`packages/server/src/patch/ts/`).

`initValContent` — the *readers*, all a rendering deployment needs — imports
`createValServer` from `@valbuild/server` exactly like `initValServer` does, so
**there is no lighter read path to pick today**.

## 5. The seam that already exists

`ValOps` has two implementations: `ValOpsFS` (disk) and `ValOpsHttp`
(**fetch-only, no `fs` at all**). Val is already written against an abstract
backend. What is missing is not the abstraction but the *dispatch*: `/save` in
`ValServer.ts` branches on `serverOps instanceof ValOpsFS` / `instanceof
ValOpsHttp`, and `createValOps` returns that two-member union. So there is no
`publish()` to override — adding one is the work.

And the handoff is already the right shape:

```ts
PreparedCommit.patchedSourceFiles: Record<string, string | null>   // null = delete
```

Path → content, which is exactly what the platform publishes. `prepare()` is on
the shared abstract class, so both backends are already downstream of it.

**The intended seam:** `commitPrepared(preparedCommit, meta)` on `ValOps`, with
FS, Http and val-start as three implementations, replacing the `instanceof`
branch.

## 6. The options considered

1. **http mode, publish overridden.** Patches stay on content.val.build;
   publishing writes files to the platform instead of committing to GitHub.
2. **fs mode over a virtual filesystem.** Patches are file writes into a VFS;
   publishing makes a commit and repoints.
3. **Run Val's server half in the browser tab**, isolate serves published
   content only. Patches ideally still on content.val.build.
4. **http for storage, client-side publish.** The override returns the prepared
   files to the caller, which writes them and publishes.

**Chosen direction: 3**, with a caveat found while costing it: the credential.
`ValOpsHttp` authenticates with either `apiKey` (the *app's* secret — cannot go
in a tab) or `pat` (per-user). Val deliberately stopped building PAT-based
requests server-side. So a tab talking to content.val.build directly needs a PAT
flow and CORS, or the isolate keeps a **credential proxy**: the tab does the
work, `/api/val/*` in the isolate attaches the key and forwards. The proxy shape
needs no `fs`, no TypeScript, no chokidar.

## 7. What now runs inside the isolate

**Val's server half runs in a Cloudflare Worker isolate, and the Studio reads
the real project through it.** `/api/val/stat` answers:

```json
{"type":"did-change","baseSha":"7236c91a…","schemaSha":"3e5eead8…",
 "sourcesSha":"95832bfb…","patches":[],"profileId":null,"mode":"fs",
 "config":{"defaultTheme":"dark"}}
```

and the Studio's Pages panel lists the project's route. Those shas are computed
from the project's actual modules, and the TypeScript compiler is doing the work
— `ts.createSourceFile` / `ts.createPrinter` parse and print inside workerd,
verified on its own before any of Val was attempted.

This means **option 3's premise is weaker than it looked**: the server half does
not *have* to move to the tab. It can, and there may still be good reasons
(8.7 MB of compiler per isolate, cold start), but "a Worker cannot run it" is no
longer one of them.

### What it took, on the platform side

Both changes are in `freekh/experiment-browser-built-tanstack-start`.

- **Server-only dependencies.** The vendor layer built every specifier for both
  targets and dropped it if either failed, so `@valbuild/tanstack/server` could
  never be layered. Specifiers are probed per target now; one that builds for
  the worker and not the browser is kept as server-only, and a client import of
  it is rejected by name.
- **Node shims, opt-in behind `--node-shims`.** Stubs for what the isolate
  lacks, real re-exports for what it has, and a real in-memory `fs`
  (`memory-fs.ts`) rather than a throwing stub — which is also the shape
  `ValOpsFS` would need to run here.

Five things cost real time, each worth knowing:

1. **The import audit had a false positive.** It scanned emitted text with
   `/from\s*["']([^"']+)["']/`, which matches inside string literals — and
   TypeScript's diagnostics contain `Consider using 'import * as ns from
   "mod"'`. Bundling the compiler was rejected for importing a package called
   `mod`. `prettier` was rejected the same way, so the earlier claim that it
   "needs node:module" was never true.
2. **A CJS `require` of an external throws at startup.** `require("path")`
   becomes rolldown's `__require`, and the isolate has no `require`.
3. **`__filename` is not defined**, and TypeScript reads it while choosing a
   host.
4. **A stub exporting only `default` breaks CJS interop** —
   `fs.realpathSync.native` becomes `undefined.native`.
5. **Guessing a builtin's shape fails silently.** `import * as ns from
   'node:path'; ns.join` was undefined, surfacing as `ue.join is not a function`
   from inside minified Val code. `path` is a bundled pure-JS implementation
   now. `nodejs_compat` is *not* the fix: it became the default at compatibility
   date 2026-08-04 and passing it explicitly is an error.

### The Val change

`initVal().isValEnabled()` reached `@tanstack/react-start/server` from the root
entry. The edge is **inverted** rather than moved: the root holds a slot
(`valEnableCookieBridge.ts`) and `@valbuild/tanstack/server` fills it on import
with `hasValEnableCookieOnServer` — the identical implementation that already
existed there. Public API unchanged.

### Where it stops today

- **Nothing has been edited yet.** The Studio reads; `commitPrepared` does not
  exist, and no patch has been made or applied. That is the next step and the
  actual goal.
- The Studio's AI endpoints answer 500/401. The assistant, not the editor.
- `prettier` is dropped as the patch formatter: its bundle hits a TDZ cycle in
  the isolate (`Cannot access 'y' before initialization`). The formatter is
  optional, but it is what would keep written patches formatted like the repo.
- `vm` throws by name. A Worker forbids dynamic code generation, so
  `loadValModules` and `evalValConfigFile` cannot work here at all. An app that
  imports its own `val.modules` never reaches them — but the CLI and the
  language server do, and anything that wants to *discover* modules rather than
  be handed them will hit this wall.
- The isolate is in `mode: "fs"` with an **empty** in-memory filesystem. Reads
  work because `valModules` is passed in as a real import. Anything that
  genuinely touches `.val/patches` has nothing behind it yet.

### The next step

`commitPrepared(preparedCommit, meta)` on `ValOps`, replacing the `instanceof`
branch in `/save`. `PreparedCommit.patchedSourceFiles` is already
`Record<path, string | null>`, which is exactly what the platform publishes — so
the val-start implementation is "write these files, then publish", and the
demonstration is the rendered site changing.

## 8. Rules for this work

- Val's `.claude/CLAUDE.md` applies: no `@ts-expect-error`, no `as any`, ask
  before type assertions, annotate return types rather than `as const`.
- `architecture/patch-store.md` must be read before touching `ValOpsFS` or
  anything under `.val/patches`.
- Changes for this experiment live in `@valbuild/tanstack` where they can, and
  are marked experimental.
- Nothing here is committed to `main`.
