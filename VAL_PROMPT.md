# Val Start — running Val inside the browser-built platform

A living document. It is written so the work can be **rebuilt from it** rather
than archaeologically recovered from commits: the goal, the decisions and why
they were taken, what has actually been proven, and what is still guesswork.

Keep it current as the work moves. When something here turns out to be wrong,
correct it in place and say so — a stale line here is worse than no line.

**Status: the Studio creates patches and Val applies them to `.val.ts` source,
all inside the isolate. The patch does not yet leave it, so the rendered site
does not change.** Nothing here is a design Val should
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

### The write path works too

Typing in the Studio creates a patch, and `/save` applies it to the `.val.ts`
source through the TypeScript AST — inside the isolate. Evidence rather than
assertion: both shas move (sources `95832bfb` → `fb0b6f1a`, base `7236c91a` →
`bb720ff9`) and `/stat` returns `patches: []`, so the patch was consumed, not
merely recorded. The Studio behaves normally throughout — rich text with
bold/italic/lists, a Review count, and a client-side `validation.worker` that
finds a real error in the project and offers "Fix 1".

That last point is worth noting for the question of where validation belongs:
**the Studio already validates in a Web Worker in the browser.**

Three things were needed:

- **File descriptors** in the memory filesystem. Val's patch store is not naive
  about durability: the lock is `openSync(path, 'wx')` — `O_CREAT|O_EXCL` — and
  that atomicity is the point, so it cannot be faked with `existsSync` plus a
  write. The ordering log appends through a descriptor, and `fsyncSync` is
  called on a **directory** fd after a rename. (`architecture/patch-store.md`.)
- **Seeding the filesystem with the project's source.** `prepare()` reads the
  `.val.ts` file to patch it, so an empty fs failed with `File not found:
  /bundle/src/routes/_site.index.val.ts`. The platform has those files; the
  publish step now writes them as a sibling module of the vendor layer and the
  shim seeds itself from it at module scope.
- **Putting the seed in the layer revision.** The rev is derived from the built
  chunks, so adding a module afterwards left it unchanged and the loader kept
  serving the previously stored layer — a chunk importing a module that was not
  there.

### Where it stops today

- **The patch never leaves the isolate.** Patches and the patched source live
  in the isolate's MEMORY. A republish makes a fresh isolate and they are gone
  — observed, not theorised. The rendered site is still built from the files on
  disk, so **it does not change yet**. Carrying the patched file back out to the
  platform's publish is `commitPrepared`, and it is the one step left.
- **Save is gated in the UI** by a validation error the project already has
  ("Fix 1"), so the save above was driven through the API. Not a platform
  problem, but it means the button has not been exercised.
- The Studio's AI endpoints answer 500/401. The assistant, not the editor.
- `prettier` is dropped as the patch formatter: its bundle hits a TDZ cycle in
  the isolate (`Cannot access 'y' before initialization`). The formatter is
  optional, but it is what would keep written patches formatted like the repo.
- `vm` throws by name, and nothing called it. See "`vm` is a packaging problem"
  below — this is a weaker constraint than it first looked.
- The isolate is in `mode: "fs"` with an **empty** in-memory filesystem. Reads
  work because `valModules` is passed in as a real import. Anything that
  genuinely touches `.val/patches` has nothing behind it yet.

### `vm` is a packaging problem, not a runtime one

Traced after the spike, because `vm` looked like a hard wall and is not one.

**The request path never evaluates Val modules.** `ValOps` derives everything it
serves — sources, schemas, `baseSha`/`schemaSha`/`sourcesSha` — by calling
`extractValModules(this.valModules)` on the value the app handed it
(`ValOps.ts:282`). `packages/core/src/extractValModules.ts` imports nothing from
Node: it is pure functions over an in-memory `ValModules`. That is exactly the
`/stat` response this spike got working.

The two `vm` users are **not** in that path:

| caller | reached from |
| --- | --- |
| `createService` → `loadValModules` (`Service.ts:103`) | CLI `runValidation`, CLI `listUnusedFiles`, language-server `ValProject` |
| `evalValConfigFile` | CLI `validate`, `connect`, `listUnusedFiles`, debug |
| `loadValModules` directly | CLI debug `context.ts`, `server/src/debug/replaySnapshot.ts` |

`createValServer`, `ValRouter` and `ValOps` reach none of them. `vm` enters the
bundle only because `packages/server/src/index.ts` is one barrel that exports
the request path and the tooling together.

This is why the spike worked with `vm` stubbed to throw on any access: nothing
called it. That was structural, not luck.

**So both of the obvious fixes work, and they are not equivalent:**

1. **Separate the entry.** Move `createService`, `loadValModules` and
   `evalValConfigFile` behind their own export (`@valbuild/server/tooling`).
   The request path then cannot reach `vm`, `chokidar` or the TypeScript
   compiler *by construction*, and any host — not just this one — gets a
   server bundle that is Val's ~1.2 MB of logic rather than 16 MB.
2. **Dynamic import inside the barrel, and never call it.** Cheaper, and it is
   what `isValEnabled` already tried. It does not survive a host that bundles
   ahead of time and audits chunks: a dynamically imported chunk is still a
   chunk. It would work *here* only because we shim what it asks for.

(1) is the real fix. (2) is a smaller change that leaves the coupling in place.

**What this does not remove.** The CLI, the language server and `val validate`
genuinely evaluate `.val.ts`, and should keep doing so — they run on Node. The
claim is only that the *server request path* has no such need, which the code
already reflects.

**Caveat, stated plainly:** only the READ path has been exercised. `/stat` and
the Studio's Pages listing work with `vm` throwing. The write path — `/save`,
`prepare`, patch application — has not been run yet, and
`adoptCommittedSources` resolves an entry's committed content through the
marker's own `import()`, which is a dynamic ESM import whose behaviour in an
isolate is unknown. That is the next thing to find out, and it is the same step
as `commitPrepared`.

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
