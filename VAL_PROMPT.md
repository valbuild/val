# Val Start — running Val inside the browser-built platform

A living document. It is written so the work can be **rebuilt from it** rather
than archaeologically recovered from commits: the goal, the decisions and why
they were taken, what has actually been proven, and what is still guesswork.

Keep it current as the work moves. When something here turns out to be wrong,
correct it in place and say so — a stale line here is worse than no line.

**Status: spike in progress.** Nothing here is a design Val should adopt yet.

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

## 7. The current spike, and what it has cost

Trying to run `@valbuild/server` (hence TypeScript) **inside the isolate**,
because if that works, option 3's browser half becomes optional rather than
required. Behind `--node-shims` on the platform's publish CLI, opt-in, so the
import audit keeps its guarantee for everything else.

Cleared so far, each a real finding:

1. **The audit had a false positive.** It scanned emitted text with
   `/from\s*["']([^"']+)["']/`, which matches inside string literals — and
   TypeScript's diagnostics contain `Consider using 'import * as ns from
   "mod"'`. So bundling the compiler was rejected for importing a package called
   `mod`, which does not exist. `prettier` was rejected the same way. The audit
   parses the module now. **This means the earlier claim that "prettier needs
   node:module" was at best unproven.**
2. **CJS `require` of an external throws at startup.** TypeScript does
   `require("path")`; rolldown emits `__require("path")`, and the isolate has no
   `require`. Fixed by routing provided builtins through a *bundled* module that
   re-exports `node:path`, turning the CJS require into a static ESM import.
3. **`__filename` is not defined.** Defined at build time for the shimmed build.
4. **In progress:** `Cannot read properties of undefined (reading 'native')`.
   The stub modules export only `default`, so a CJS `require("fs")` that reads
   `fs.realpathSync.native` gets `undefined.native`. Next step is a real
   in-memory `fs` rather than a throwing stub — which is needed anyway if
   `ValOpsFS` is ever to run here.

**Open question this spike answers:** can TypeScript parse and print inside
workerd at all? Until a route returns a printed AST, everything above is
plumbing, not proof.

## 8. Rules for this work

- Val's `.claude/CLAUDE.md` applies: no `@ts-expect-error`, no `as any`, ask
  before type assertions, annotate return types rather than `as const`.
- `architecture/patch-store.md` must be read before touching `ValOpsFS` or
  anything under `.val/patches`.
- Changes for this experiment live in `@valbuild/tanstack` where they can, and
  are marked experimental.
- Nothing here is committed to `main`.
