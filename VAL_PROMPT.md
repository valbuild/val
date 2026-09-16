# Val Start — running Val inside the browser-built platform

A living document. It is written so the work can be **rebuilt from it** rather
than archaeologically recovered from commits: the goal, the decisions and why
they were taken, what has actually been proven, and what is still guesswork.

Keep it current as the work moves. When something here turns out to be wrong,
correct it in place and say so — a stale line here is worse than no line.

**Status: the loop is closed — an edit in Val Studio changes what the live site
serves.** Patches are still isolate-local, and the build step is a Node
stand-in for the Studio tab; see §8b and §9. Nothing here is a design Val should
adopt yet.

---

## 1. The goal

Val Studio running _inside_ the browser-built platform
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

`initValContent` — the _readers_, all a rendering deployment needs — imports
`createValServer` from `@valbuild/server` exactly like `initValServer` does, so
**there is no lighter read path to pick today**.

## 5. The seam that already exists

`ValOps` has two implementations: `ValOpsFS` (disk) and `ValOpsHttp`
(**fetch-only, no `fs` at all**). Val is already written against an abstract
backend. What is missing is not the abstraction but the _dispatch_: `/save` in
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
`ValOpsHttp` authenticates with either `apiKey` (the _app's_ secret — cannot go
in a tab) or `pat` (per-user). Val deliberately stopped building PAT-based
requests server-side. So a tab talking to content.val.build directly needs a PAT
flow and CORS, or the isolate keeps a **credential proxy**: the tab does the
work, `/api/val/*` in the isolate attaches the key and forwards. The proxy shape
needs no `fs`, no TypeScript, no chokidar.

## 7. What now runs inside the isolate

**Val's server half runs in a Cloudflare Worker isolate, and the Studio reads
the real project through it.** `/api/val/stat` answers:

```json
{
  "type": "did-change",
  "baseSha": "7236c91a…",
  "schemaSha": "3e5eead8…",
  "sourcesSha": "95832bfb…",
  "patches": [],
  "profileId": null,
  "mode": "fs",
  "config": { "defaultTheme": "dark" }
}
```

and the Studio's Pages panel lists the project's route. Those shas are computed
from the project's actual modules, and the TypeScript compiler is doing the work
— `ts.createSourceFile` / `ts.createPrinter` parse and print inside workerd,
verified on its own before any of Val was attempted.

This means **option 3's premise is weaker than it looked**: the server half does
not _have_ to move to the tab. It can, and there may still be good reasons
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
   now. `nodejs_compat` is _not_ the fix: it became the default at compatibility
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

| caller                                                | reached from                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| `createService` → `loadValModules` (`Service.ts:103`) | CLI `runValidation`, CLI `listUnusedFiles`, language-server `ValProject` |
| `evalValConfigFile`                                   | CLI `validate`, `connect`, `listUnusedFiles`, debug                      |
| `loadValModules` directly                             | CLI debug `context.ts`, `server/src/debug/replaySnapshot.ts`             |

`createValServer`, `ValRouter` and `ValOps` reach none of them. `vm` enters the
bundle only because `packages/server/src/index.ts` is one barrel that exports
the request path and the tooling together.

This is why the spike worked with `vm` stubbed to throw on any access: nothing
called it. That was structural, not luck.

**So both of the obvious fixes work, and they are not equivalent:**

1. **Separate the entry.** Move `createService`, `loadValModules` and
   `evalValConfigFile` behind their own export (`@valbuild/server/tooling`).
   The request path then cannot reach `vm`, `chokidar` or the TypeScript
   compiler _by construction_, and any host — not just this one — gets a
   server bundle that is Val's ~1.2 MB of logic rather than 16 MB.
2. **Dynamic import inside the barrel, and never call it.** Cheaper, and it is
   what `isValEnabled` already tried. It does not survive a host that bundles
   ahead of time and audits chunks: a dynamically imported chunk is still a
   chunk. It would work _here_ only because we shim what it asks for.

(1) is the real fix. (2) is a smaller change that leaves the coupling in place.

**What this does not remove.** The CLI, the language server and `val validate`
genuinely evaluate `.val.ts`, and should keep doing so — they run on Node. The
claim is only that the _server request path_ has no such need, which the code
already reflects.

**Caveat, stated plainly:** only the READ path has been exercised. `/stat` and
the Studio's Pages listing work with `vm` throwing. The write path — `/save`,
`prepare`, patch application — has not been run yet, and
`adoptCommittedSources` resolves an entry's committed content through the
marker's own `import()`, which is a dynamic ESM import whose behaviour in an
isolate is unknown. That is the next thing to find out, and it is the same step
as `commitPrepared`.

## 8b. The loop is closed

```
before  This page is built with Val Build - the lightweight CMS where content is code.
after   Edited live in Val Studio, running inside a Cloudflare Worker.
```

Typed in the Studio, saved through Val's real save path, and served by the
isolate on the next request.

### How to run it yourself

```
# once
cd val && pnpm install && pnpm build          # ~50s; the FULL build, see below
cd ../experiment-browser-built-tanstack-start
pnpm dev:loader                               # leave running

# set up the playground, linked to your Val checkout
pnpm val:playground --mode studio --project valreal --val-source ../valbuild/val

# edit at http://valreal.localhost:8787/val -- pick the page, change a field
# then hand the patched source to the builder and republish
pnpm val:republish --project valreal

# and read it back
curl -H 'x-bbs-project: valreal' http://localhost:8787/ | grep page-description
```

### Why it is three steps and not one

**The isolate cannot build.** rolldown is not in there, and putting it there
means shipping a bundler into every request. So:

1. Val's `commitPrepared` hands the patched files to the host
2. the app posts them to `/__api/source`, which parks them per project
3. something that can build picks them up and publishes

Step 3 is `pnpm val:republish`, and it is a **stand-in**. It belongs in the
Studio tab, which already runs the builder and would publish from its own
in-memory file record with no disk involved. Running it from Node keeps the loop
honest end to end while that half is unbuilt.

Parked source is deleted only after a successful publish: source that was never
built is the only copy of that edit.

### Two things that cost real time

- **`npx preconstruct build` alone leaves `$$BUILD_$$REPLACE_WITH_VERSION$$`
  unreplaced.** The Studio then asks for its bundle at a placeholder version and
  500s. The full `pnpm build` is needed for anything crossing a package version,
  not only for UI changes. This is the second time it bit.
- **`commitPrepared` was passed positionally to `createValServer`**, whose
  signature ends `(callbacks, formatter)`. It silently did nothing — the save
  returned 200 and parked no files, which is indistinguishable from a save that
  worked. Fixed by giving `createValServer` the parameter.

The template only rendered `sections`, so an edited description changed the
content and nothing visible; the playground copy renders it now.

## 8c. `/stat` long-polls, and that is wrong in an isolate

**Resolved by §8d/§8e — but NOT by option 2 below, which was wrong.** The
analysis here is right about what `fs` mode wastes and wrong about what to do
instead. See §8e, "the hold is the rate limit".

**Observed:** the Studio hammers `/api/val/stat` continuously. Worth being
precise about, because part of it is by design and part of it is not.

### What it is

In `fs` mode `getStat` is a **long-poll**, not a request. It holds the response
open and races four things (`ValOpsFS.ts`, ~line 440):

|                                                                                   |                                               |
| --------------------------------------------------------------------------------- | --------------------------------------------- |
| `didDirectoryChangeUsingPolling` on `.val/patches`                                | `statFilePollingInterval`, default **250 ms** |
| `didFilesChangeUsingPolling` on `val.config`, `val.modules` and every module file | same 250 ms                                   |
| `fs.watch` on the same files                                                      | event-driven                                  |
| a timeout resolving `"no-change"`                                                 | `statPollingInterval`, default **20 s**       |

The client re-requests as soon as it returns. That is deliberate and correct for
local development: the developer edits a `.val.ts` in their editor and the
Studio notices without a reload.

### Why it is wrong here

- **`fs.watch` is a no-op** in the platform's shim — it returns an object with a
  `close` that never fires. So the event-driven branch can never win.
- **`mtime` is always 0** in the in-memory filesystem, so the file-mtime poller
  can never see a change either. The patches-directory poller still works,
  because it compares the _number_ of entries, which is why `request-again`
  appears after a patch is created.
- So in practice every stat runs a **250 ms timer for up to 20 s** and then
  answers `no-change`, and the client immediately asks again. In a Worker that
  keeps the isolate alive and bills CPU for a timer that cannot observe
  anything.
- **The watch has nothing to watch.** Nothing edits files behind Val's back in
  an isolate: source changes only through a republish, and a republish creates a
  _new_ isolate with new content. The entire mechanism is answering a question
  that cannot have a different answer.

Note also that the retry storm seen while saves were failing was a _separate_
cause — the Studio re-sending a save it could not complete. Fixing that did not
stop the polling, because the polling is not a symptom of it.

### The fix, in increasing order of correctness

1. **`disableFilePolling: true`** already exists on `ValOps` options
   (`ValOps.ts:133`) and kills both 250 ms pollers. It is **not** threaded
   through `initValServer`, so a TanStack app cannot set it today. This is the
   one-line-ish change, and it leaves a 20 s hold per request.
2. **Answer immediately.** In this configuration `getStat` should return
   `no-change` without waiting at all, and let the client choose its cadence.
   That needs a way to say "there is no watcher here" — a mode flag, or
   inferring it from a filesystem that reports no watch support.
3. **Stop calling this `fs` mode.** The isolate is not a developer's machine.
   The mode is chosen in `createValOps` by `options.mode`, and a third backend
   would not inherit the watching at all — which is §9.2.

Worth doing (1) now to stop the CPU burn, and (2) as the real answer.

**What happened:** (3), and (2) turned out to be a mistake — see §8e. The
client sets `wait: 0` between stats unless it has a WebSocket, so the server's
hold is the only thing pacing it; answering immediately produced a request every
6 ms. What is actually wrong with `fs` mode here is the WATCHING, not the
holding. The third mode keeps the hold and parks it on a signal.

## 8d. The third mode — BUILT, and the loop runs on it

**Status: done and exercised end to end.** `ValOpsMemory` is in
`packages/server/src/ValOpsMemory.ts`, selected by `mode: "memory"`, and the
whole edit → save → republish → live-site loop now runs through it. See
[§8e](#8e-what-the-third-mode-fixed) for what it fixed and what it did not.

**Decided: build a third `ValOps`.** `fs` mode is a developer's machine and
`http` mode is content.val.build; this host is neither, and forcing it into `fs`
is what produces the failures below.

### What forcing `fs` mode has already cost

- **`/stat` long-polls** against watchers that cannot fire (§8c).
- **`/api/val/enable` 500s** with `ReferenceError: Cannot access 'fs' before
initialization` — a temporal-dead-zone error inside a bundled vendor chunk,
  the same class as prettier's `Cannot access 'y'`. It comes from the shimmed
  `fs` graph participating in a module cycle. Chasing the minified cycle is the
  wrong fix: in this mode Val should not be reaching for `fs` at all.
- Every read of a `.val.ts` goes through an in-memory filesystem seeded from a
  sibling module, when the host could simply hand Val the source.

### The surface

`ValOps` has **17 abstract members**. With remote-files-only (§9.4) they split
three ways:

|                         |                                                                                                                                                                                                      |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **implement** (6)       | `getStat`, `onInit`, `fetchPatches`, `saveSourceFilePatch`, `getSourceFile`, `deletePatches`                                                                                                         |
| **refuse, clearly** (4) | the local binary-file ones — `saveBase64EncodedBinaryFileFromPatch`, `getBase64EncodedBinaryFileFromPatch`, `getBinaryFile`, `getBinaryFileMetadata`. Remote files do not go through these.          |
| **empty, for now** (6)  | git history — `listCommits`, `getCommitPatches`, `getCommitModules`, `getCommitAffectedFiles`, `getFileAtCommit`, `gitPathOfModule`. There is no git here; the History UI degrades rather than lies. |

Two things outside that list:

- **`saveOrUploadFiles` is not on the base class.** It exists only on
  `ValOpsFS`, and `/save` reaches it through `instanceof`. A third mode means
  `/save` stops branching on the class — which is the same change §9.3 wants,
  now forced rather than optional.
- **`getSourceFile` should read from the host, not a disk.** The platform
  already ships the project's source into the isolate; handing it to `ValOps`
  directly removes the memory filesystem from Val's path entirely.

### The shape

A **pluggable patch store**, so the mode is not tied to where patches live:

```ts
interface ValPatchStore {
  list(): Promise<PatchId[]>;
  get(id: PatchId): Promise<StoredPatch | null>;
  put(patch: StoredPatch): Promise<void>;
  delete(ids: PatchId[]): Promise<void>;
}
```

In-memory is the first implementation and is explicitly **not durable** — a
republish makes a new isolate and the patches are gone. A Durable Object is the
second (§9.2), and the interface is what makes that a swap rather than a
rewrite.

`getStat` answers immediately: nothing edits files behind Val's back here, so
there is nothing to wait for (§8c).

## 8e. What the third mode fixed

Built as scoped above. Measured against the same playground, `--mode studio`.

### The loop, verified

Every step below was run against a freshly published build, not a hand-modified
working copy:

| step                                       | result                                                                                                      |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `PUT /api/val/patches`                     | `{"newPatchIds":["8b45e9b0-…"]}` — stored in `ValOpsMemory`                                                 |
| `POST /api/val/stat`                       | lists the patch at once; an idle stat holds 20 s; `mode: "fs"`                                              |
| `PUT /api/val/sources/~` with the patch id | the edited value comes back                                                                                 |
| `POST /api/val/save`                       | `{}` — the patch is applied to the real `.val.ts` through Val's TS AST, and `commitPrepared` parks the file |
| `GET /__api/source`                        | the parked `.val.ts` carries the edit                                                                       |
| `pnpm val:republish`                       | new build published                                                                                         |
| `GET /`                                    | the live page serves the edited text                                                                        |
| `GET /api/val/patches`                     | empty; the base sha has moved                                                                               |

`/api/val/enable` answers `302` with both cookies. The Studio itself loads at
`/val` and reports "All changes saved".

### Three things it fixed

1. **`/stat` still long-polls — but parks on a signal, not a timer.**

   I got this wrong once, and it is worth recording because the wrong version
   looked like a fix: `/stat` got faster. The first cut answered immediately, on
   the reasoning that nothing can edit files behind Val's back in an isolate.
   True, and beside the point — **the hold is the rate limit**. `useStatus.ts`
   sets `wait: 0` between stats unless it has a WebSocket, with the comment "we
   are long polling so no point in waiting". Answering in 6 ms turned a poll
   every 20 s into a request every 6 ms: worse than what it replaced, and caught
   from the request log rather than by anything here.

   What is actually wrong with `fs` mode is the WATCHING. It races a 250 ms
   mtime poll and an `fs.watch`, neither of which can observe anything in an
   isolate — the shim's `watch` never fires and mtime is always 0 — so it burns
   CPU for 20 s to learn nothing. `ValOpsMemory` owns its store, so it is TOLD:
   `saveSourceFilePatch` and `deletePatches` wake every parked `getStat`. No
   timers while parked, and a patch written by another tab is seen at once
   rather than up to 250 ms later.

   The timeout is the backstop, and not only for an idle branch: **a republish
   cannot be announced**, because it happens in a different isolate. So the
   Studio notices a new build within the poll interval rather than immediately.
   A store shared between isolates (§9.2) has the same property, which is why
   `getStat` re-reads on the way out instead of assuming `no-change`.

   `ValOpsMemory.stat.test.ts` pins both halves — a stat with nothing to report
   must NOT return promptly, and a write must cut the hold short. Neither alone
   is the requirement, and each direction was checked against a negative
   control.

2. **`/enable` 500 — and it was NOT what §8d assumed.** The `ReferenceError:
Cannot access 'fs' before initialization` was not the shimmed filesystem
   being in a module cycle. It was the platform's re-export shims **importing
   themselves**: `nodeShims`' `resolveId` mapped every `node:X` to the shim for
   `X`, including the `node:X` inside that very shim. So

   ```js
   import * as ns from "node:stream"; // -> resolves back to the stream shim
   const mod = ns.default ?? ns; // -> const mod = mod ?? ns
   ```

   and the minifier, which can see that `ns.default` IS `mod`, emitted
   `const fs=fs??ds` verbatim. A TDZ, named after a minified identifier with
   nothing to do with `fs`.

   It was also **silently wrong everywhere it did not throw**: a shim that
   imports itself never reaches the builtin, so `pick()` answered `undefined`
   for every name. That is the real reason `crypto.randomUUID` needed a Web
   Crypto fallback — the `node:crypto` half was never reaching `node:crypto`.
   One line in `packages/publish/src/node-shims.ts`: an importer that is itself
   a shim gets the builtin as an external.

3. **Val no longer reads a filesystem for source.** `sourceFiles` is handed in.
   The platform ships the project's own source into the isolate as
   `bbs:project-source` — the same seed module the memory filesystem uses,
   now registered in the project's vendor layer so a project can `import
{ FILES } from 'bbs:project-source'`. Worker-only: a client import of it is
   rejected by name.

### What changed in Val, beyond the new file

`instanceof ValOpsFS` was the routes' way of asking "is this a local store" —
correct while there were two implementations, and silently wrong with three: a
local store would have answered none of the checks and taken the http path with
no content service behind it. It is now
`ValOps.patchesAreLocal`, a named abstract property, at all 17 policy sites.
Three sites keep `instanceof ValOpsFS` deliberately, each because it calls
something only a filesystem has: `saveOrUploadFiles`, the AI-image mirroring
into a patch directory, and the presigned-nonce lookup.

`/stat`'s wire `mode` is derived from `patchesAreLocal` too. It still answers
`"fs"` — the wire name predates the third implementation, and the question the
client is actually asking ("do I auto-save, or do I publish?") has the same
answer for both local stores. `"unknown"` used to be a 500.

### The lost-edit bug, and what it teaches

Found by the user, not by anything here: patch, save, patch, save, republish —
and the first edit was gone, with no error at any stage.

`getSourceFile` answered from the source the host handed over at construction,
and nothing moved it. `fs` mode's equivalent is a disk that `saveOrUploadFiles`
has just rewritten, so the next `prepare()` reads the previous save's output.
With no disk here, the second save re-read the ORIGINAL `.val.ts`, applied only
its own patch to that, and parked a file that reverts the first. Silent, because
applying a patch to the original text succeeds perfectly well.

**The Studio auto-saves**, so this was not an edge case — it was most of a
session's work.

`ValOps.adoptCommittedSources` now also hands the committed `.val.ts` TEXT to
`adoptPatchedSourceFiles`, a no-op wherever `getSourceFile` reads something the
commit already wrote. It is on the base class and called from the one place that
already existed, so a store cannot adopt sources without being offered the text.
`ValOpsMemory.save.test.ts` pins it, negative-controlled (remove the hook: 2 of 3
fail).

The lesson for the rest of §9: **`fs` mode gets things for free by writing to a
disk and reading it back, and every one of those is a gap here.** This was the
second (after `/stat`'s pacing). Worth auditing the remaining ones deliberately
rather than waiting to be told.

A second, unrelated cause of "I saved and nothing changed": the starter
template renders `meta.description` and `sections`, and hardcodes its
`<title>`. Editing Meta → Title changes the data and nothing visible.
`val:republish` now prints a real diff of the file it wrote, so a change that
is invisible on the page is still visible in the output — it used to print the
first line containing a long string, which on this template was reliably an
unrelated `import`.

### The fs-freebie audit

The pattern behind three of this mode's bugs, stated once: **`fs` mode gets
things for free by writing to a disk and reading it back, and every one of those
is a gap here.** Audited deliberately rather than waiting for the next report.

| what a save changes       | what reads it later                                  | memory mode                                |
| ------------------------- | ---------------------------------------------------- | ------------------------------------------ |
| `.val.ts` text            | `getSourceFile`, on the next `prepare()`             | **was broken** — `adoptPatchedSourceFiles` |
| `.val.json` entry content | `getJsonEntries` → the marker's own `import()`       | base class, via `adoptedJsonEntries`       |
| `.val.json` FILE          | `getSourceFile`, when a patch is applied to an entry | **was broken** — see below                 |
| evaluated Sources         | `promoteCommittedSources`                            | base class                                 |
| the SHAs                  | recomputed from the fold                             | base class                                 |
| pending patches           | the store                                            | `ValPatchStore`                            |
| pending binary files      | the store                                            | `putFile`/`getFile`                        |
| published binary files    | a `/public` directory                                | n/a — remote files only                    |
| `appliedAt` per patch     | `scopedModulePatches`                                | n/a — a save deletes its patches           |

Two things the audit found that reasoning had got wrong:

- **Applying a patch to a `.jsonValues()` entry READS its `.val.json` through
  `getSourceFile`.** Reading one for display goes through the marker's
  `import()`, so it looked as though `sourceFiles` was not involved at all. It
  is, on the write path — and the platform's `readSources` collected only
  `.tsx?|jsx?|mjs|cjs`, so a project using `.jsonValues()` could not save an
  entry edit at all. The save failed with `File not found: …/x.val.json` and
  nothing else explained why.
- **`saveSourceFile` on `ValOpsFS` is dead code.** Nothing calls it. It looks
  like a seam a third mode would need, and is not one.

Two gaps left open deliberately: bytes uploaded for a patch that is never
recorded stay until the store is dropped (`fs` mode sweeps its staging
directory; nothing sweeps this one), and the `jsonEntriesSha` that `fs` mode's
stat carries has no counterpart — an entry-only change is reported through the
patch list instead.

## 8f. Option B: the content service owns the patches

**Decided and verified.** `fs` mode is a developer's machine, and the in-memory
mode (§8d) is this platform holding everything itself. Option B is the third
answer: Val's content service owns the patches, and a publish makes a real git
commit AND a new build.

### Why the commit is not optional

`ValOpsHttp.getSourceFile` fetches a path from the content service **at a commit
sha**. So http mode only works if some commit describes what the running code
was built from. Committing at publish creates exactly that sha; the rebuild
carries it; source and build agree again. Without the commit there is no sha to
give it, and Val edits a different version of a file than the site is serving.

That makes the sha travel:

    publish → commitToGit() → newSha
            → park(files, newSha)  →  /__api/source
            → val:republish builds with VAL_GIT_COMMIT=newSha

The commit goes FIRST. If it fails there is nothing to publish, and parking
files against a commit that does not exist would leave the next build reading
content from a sha the content service has never heard of.

### `publishOverride`

The seam this needed, and the one asked for at the very start: "a generic
override that can be used in Val to make the publish do other stuff than the
default in http mode (which is writing to github)".

It is handed the default as `commitToGit` rather than having it skipped. A host
can REPLACE the commit or ADD to it, and those are two different products — one
where the repository is the record, one where the build is. The seam does not
pick; the host does, at runtime.

### Verified, against `e2e/mock-content-host`

Val's own mock implements the patch, commit and file routes over an in-memory
overlay with **no git repository behind it**, and serves `location: "repo"`
reads from a directory on disk. That is what made this testable at all: the test
project has no repo, and a Worker cannot reach the real content host from the
sandbox. Point `--val-content-url` at the mock and the whole thing runs.

|                 |                                                                                             |
| --------------- | ------------------------------------------------------------------------------------------- |
| `/stat`         | `use-websocket` — http mode's stat, which beats both polling designs                        |
| `PUT /patches`  | stored on the CONTENT HOST (confirmed independently through its own API)                    |
| `POST /save`    | `200 {"commitSha":"ff090003…"}` — a real commit, parent `mockcommit0`, author `profile-ada` |
| parked          | `{ files, commitSha: "ff090003…" }`                                                         |
| `val:republish` | builds with `VAL_GIT_COMMIT=ff090003…`                                                      |
| the live page   | serves the edit                                                                             |

### What this costs, and what it buys

Buys: durability, patch groups, verified authors, history, remote files and a
WebSocket stat — all of it Val's own production code rather than anything this
platform maintains.

Costs: a round trip per patch write, a hard dependency on the content service
for editing at all, and no anonymous editing — `patchesAreLocal` is false, so
every request needs a session. The in-memory mode remains the default for
exactly those reasons; `--val-http` selects this one.

## 8g. Images, verified — and a fourth fs freebie

Remote images now work end to end in the in-memory mode, checked against
`e2e/mock-content-host` rather than asserted:

|                                  |                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------ |
| `/remote/settings`               | `mockproj` / `mock-bucket` — the STAND-IN's values, so `getSettings` honours the configured host |
| `POST /upload/patches/:id/files` | 200, bytes held against the patch                                                                |
| `POST /save`                     | 200 — `uploadRemoteFiles` pushed at publish                                                      |
| the mock's `/__test__/state`     | `remoteFiles: ["/v1/valbuild/insta/remote/files/b/mock-bucket/f/229c9ef6….png"]`                 |

Two things had to be fixed to get there, and both are the same shape as the
bugs in §8e and the audit.

**`getSettings` read its host at MODULE scope.** So remote files addressed the
real content service no matter what the server was configured with — the same
class as `VAL_API_KEY`, and for the same reason: a host that bundles its
dependencies separately cannot set a dependency's `process.env`. It takes the
host as an argument now.

**The binary store keyed bytes by the path as UPLOADED.** An upload arrives as
`/public/val/x.png`; the publish step looks the same file up as
`public/val/x.png`, because that is what `splitRemoteRef` yields from a remote
ref (typed `public/${string}` — the leading slash is not there and never was).
`ValOpsFS` never noticed, because `path.join` collapses the difference.

That is the **fourth** thing a filesystem was doing for free, and the audit in
the table above did not catch it — the audit walked what a SAVE changes, and
this is about how a path is spelled between two different callers. Worth
remembering: the freebies are not only about persistence, they are about
normalisation too.

### What is still open

- **The patch store is not durable.** `InMemoryPatchStore` dies with the
  isolate. It survived across requests in testing because the loader keeps the
  isolate warm — that is luck, not a guarantee. §9.2 is the fix, and
  `ValPatchStore` is the seam that makes it a swap.
- **Binary files are unimplemented, not just remote.** The four local binary
  methods refuse by name. Remote files still need the bytes held pending until
  publish (that is how Val's remote files work — the push to `remote.val.build`
  happens at publish, from `saveOrUploadFiles`), so `s.image()` does not work in
  this mode yet. §9.4.
- **`--node-shims` is still required**, because `@valbuild/server` imports `fs`,
  `path` and `typescript` at module scope even when nothing calls them. Val no
  longer _uses_ the shimmed filesystem; it is still _linked_ against it.
- The AI endpoints, profiles and direct uploads need a configured Val project;
  they answer 401/500 without one, which is what the Studio screenshot shows.

## 9. What full support needs

Scoped from what the spike actually hit, not from a wishlist. Ordered by whether
it blocks the others.

### 9.1 Where does `prepare()` run? (decide first)

Everything below depends on it. Patch application is a TypeScript AST rewrite,
so **whichever side runs `prepare()` needs the 8.7 MB compiler**. Two answers:

- **In the isolate** (what the spike does). The isolate needs TypeScript, a
  filesystem and the patch store. Proven to work.
- **In the Studio tab.** The tab already runs rolldown for the build; adding
  TypeScript there costs a download, not a cold start. The isolate then only
  stores patches and serves content, and `commitPrepared` becomes "hand the
  prepared files to the client".

The second is cheaper per request and matches where the platform already
builds. The first is fewer moving parts. This is a real fork, not a detail.

### 9.2 Durable patches — this needs a Durable Object, not KV

Patches currently live in isolate memory and die with it. The obvious fix is KV,
and **KV cannot do it**: Val's store is built on a lock
(`.val/patches.lock`, opened `wx` = `O_CREAT|O_EXCL`) and an ordering log whose
_position in the file_ is the chain. KV is eventually consistent and has no
compare-and-swap, so two tabs can both believe they hold the lock, and the log
can be read stale. `architecture/patch-store.md` exists because that class of
bug already cost Val an incident.

A **Durable Object per project** is the right primitive: single-threaded
execution is the lock, and its transactional storage is the log. Work:

- a `ValFS` backed by DO storage, or a `ValOps` implementation for this platform
- **`ValOpsFS` does not go through `ValFS` consistently** — it calls `fs`
  directly in places (`fs.readdirSync` at `ValOpsFS.ts:344`, and all the
  descriptor work in `patchLock.ts` / `patchLog.ts` / `patchStore.ts`). Either
  tighten `ValOpsFS` onto `ValFS` (better for Val generally) or write a separate
  implementation.

### 9.3 Publish — `commitPrepared`, and who builds

- **Val:** replace the `instanceof ValOpsFS` / `instanceof ValOpsHttp` branch in
  `/save` with `commitPrepared(preparedCommit, meta)`.
  `PreparedCommit.patchedSourceFiles` is already `Record<path, string | null>`.
- **The build has to happen somewhere.** The isolate cannot build; the Studio
  tab already can. So the smallest shape is: `commitPrepared` returns the
  patched files, the tab writes them into its file record, builds, and calls the
  platform's publish. That also keeps the credential out of the isolate.

### 9.4 Media and binary files — **remote files only**

**Decided: this configuration uses Val's remote files feature exclusively.**

That removes most of this area. `s.image()` / `s.file()` with local storage put
uploaded bytes in `.val/uploads` before the patch record exists, and
`getBinaryFile` returns a `Buffer` — all of which would need durable binary
storage in the isolate and a serving path. With remote files the bytes live on
Val's content host and the patch carries a reference, so the isolate never holds
them.

What is left of it: the remote-file upload path has to work from the Studio (it
is a fetch, so it should), and `checkRemoteRef` reads a local file in one place
(`checkRemoteRef.ts`) which needs checking against a no-local-files
configuration. `ValOps` still uses `Buffer` in 8 places; fine in a Worker.

### 9.5 Draft mode and preview

The Studio's Preview renders the site with _unpublished_ patches applied. That
is `initValContent` + `draftMode`, which exist — but the isolate has to be able
to read the pending patches at render time. Mostly falls out of 9.2.

### 9.6 Val packaging (worth doing regardless)

Split `@valbuild/server`'s barrel so the request path does not import the
tooling (`createService`, `loadValModules`, `evalValConfigFile`). That removes
`vm` and `chokidar` outright. It does **not** remove TypeScript if `prepare()`
runs server-side — see 9.1.

### 9.7 Trust, which is currently wide open

- `/__api/publish` is **unauthenticated**. If the isolate publishes, any code in
  a published app can publish over any project.
- A content editor would ride the same publish path as a developer.
- `globalOutbound` clamping exists but is off (`SANDBOX=0`).

This is already recorded in the platform's ARCHITECTURE §8 as a known gap. It
stops being theoretical the moment publish is reachable from content editing.

### 9.8 Smaller, known

- The prettier formatter TDZ-crashes in the isolate; either drop it or format in
  the tab.
- **The seed ships every project source file into the worker module map.** It
  should be scoped to what Val reads (`*.val.ts`, `val.config`, `val.modules`).
- `--node-shims` is a deliberate hole in the import audit. Narrow it to a
  declared list, or delete it once 9.6 makes it unnecessary.
- Cold-start CPU for a ~20 MB layer is unmeasured.
- The Studio's AI endpoints need a configured Val project; they 401/500 today.
- Save is gated in the UI by a validation error the template already has, so the
  button itself is still unexercised.

### 9.9 Fastest route to "the site changes"

Not the same as full support, and worth doing first because it proves the whole
loop end to end:

1. `commitPrepared` returning the prepared files (9.3, Val, small)
2. the tab writes them, rebuilds and publishes (platform, reuses what exists)
3. reload the site and read the new text

Patches can stay in isolate memory for that — a single session survives it.
Durability (9.2) is what makes it a product rather than a demonstration.

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
