# One content model: every reader, one version, one engine

> **Status: proposed 2026-11-01.** Nothing here is built. Phase 0 (the
> scenario harness and its first scenario) is the first piece of work. Until
> this plan is agreed, every "decided" below is a proposal. A session that
> changes the design updates this file in the same PR as the change.

Content is read in about fifty places (listed in
[The inventory](#appendix-the-inventory)): the app's readers in and out of
draft mode, the Studio's stores, the canvas, Val's server, MCP, the CLI and
the hosting platform. Each was added for a reason, and each pairs a schema
with content in its own way. The bugs we keep meeting are where two of them
disagree: a preview that flickers, an edit that does not show, a page that
shows two versions of the content at once.

This plan reduces that to **one version**, **one engine** that turns patches
into content, and **one pull** that every surface goes through. And it makes
the result testable: a scenario that sets up the environment (server mode,
Studio, page, draft mode, network and clock) and checks the same invariants
in every scenario, so adding an edge case is a few lines and a broken
invariant is caught by name.

## The goal

1. **The same version shows the same content everywhere.** The Studio, the
   page's server-read content and the page's hooks agree, or know they do
   not.
2. **No surface goes back.** Once a surface has shown an edit, it never shows
   an older version again, unless the chain really went back (a discard), in
   which case it moves forward to the content without the edit.
3. **Up to date, and cheap.** An edit reaches every surface on an event, not
   on a timer, and reading content in draft mode costs what was edited, never
   the size of the site. It fits in a 128 MB isolate.
4. **Testable with high confidence.** Every scenario can set up the
   environment it runs in, and every scenario is checked against the same
   invariants. Most of the value is here: the invariants are checked for free
   in every scenario anyone writes, so an edge case is a script of actions
   rather than a new set of assertions.

## Why there are so many readers

Each reason is still true, and the design has to keep serving it:

| Reason                                                                                    | What it forced                                                                |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Typing cannot wait for a round trip                                                       | The Studio applies patches itself (`SourceStore`)                             |
| Schemas hold the author's closures (`validate`, `preview`), which cannot be sent anywhere | The schema always comes from the bundle, in the realm that runs it            |
| Server components and loaders decide `notFound()` and `<head>` before a browser exists    | Draft reads on the server (`fetchVal`), each with its own private `ValServer` |
| Content-only publishes and proposals                                                      | Content can be newer than the build: snapshots, `__VAL_BASE__`, BaseAlignment |
| One linear patch chain, so two writers do not 409 on every keystroke                      | The parent comes from `/stat`, with retries and verification                  |
| The edge lags, and builds deploy per location                                             | The Studio's bundle and the build answering `/stat` can be two builds         |
| Large `.jsonValues()` records                                                             | Lazy entries, loaded and invalidated on their own path                        |

## What is wrong today

- **Code and schema always come from a build; content comes from one of
  about seven places**: the bundle, the content version, the proposal's
  overlay, BaseAlignment's fetched base, patches the server applied, patches
  the browser applied, and history. Nothing names the pair, and the one check
  (`SchemaFreshnessWatch`) runs in the Studio only.
- **Patches are applied by four implementations**: the Studio's
  `SourceStore.applyEntries`, the server's `ValOps.getSources`, MCP's
  `loadState` (through `getSourcesWithPatchesApplied`), and `/save`'s
  `prepare`. The first two already disagree: the server skips an edit inside a
  `.jsonValues()` entry and writes `patch_id` into the source where a file
  lands; the Studio applies entry edits to the substituted module and stamps
  `patch_id` later, in the relay (`withFilePatchIds`).
- **A process holds up to four `ValOps`**, each with its own memo of the
  sources that only `/save` moves, and only for the instance that handled it:
  the API route, Next's RSC readers (`initValRsc.ts`), TanStack's
  `initValContent` and MCP's `createOpsResolver`.
- **A draft read costs the whole site.** `fetchVal` in draft mode answers
  `PUT /sources/~` for every module and previews and validates all of them on
  every request (`ValServer.ts:2348-2373`). home's measurements put
  validation at about 5× the content's size in memory and say about 15 MB of
  content crosses 128 MB in an isolate (`docs/plans/upgrades-v2.md` in
  valbuild/home). That path has not been measured in an isolate; phase 0 does.
- **The page refreshes before the server has the edit.** `router.refresh()`
  races the write, and the safety refresh every 10 s is what catches it
  (`architecture/quirks.md`, "The canvas can refresh before the server has the
  edit").
- **One Next page can show two versions.** Server components read the
  server's draft; client hooks show the bundle until the overlay sends content,
  and then only for the modules the Studio has changed.
- **Caches nothing invalidates**: the per-instance server memo,
  `jsonEntryPromiseCache` in the client hooks, and `projectSource` in the
  assistant's code tools.

Found on the way and not fixed here (each is its own small PR):

- `fetchVal`'s error fallback stega-encodes for every visitor, because it
  drops `disabled` (`packages/next/src/rsc/initValRsc.ts:231`, and the same in
  `packages/tanstack/src/server/initValContent.ts:271`).
- `/stat` sends `jsonEntriesSha` and nothing reads it.
- Compare with the site reads `/proposal-site-sources` with a raw `fetch`,
  not through `ValClient`.
- Staging a `.val.ts` in a proposal records its new Source with the previous
  schema's sha (`stagedModuleRows` in valbuild/home).
- MCP is not given the content version or the proposal's snapshot, so on a
  hosted site it can read another base than the Studio.

## The design

### A version, and why the newest patch is not one

The newest patch cannot be the version, because the chain changes under it:

| What happened              | Chain before | Chain after | Newest patch | Content        |
| -------------------------- | ------------ | ----------- | ------------ | -------------- |
| B is discarded             | A B C        | A C         | C → C        | different      |
| B fails and is deleted     | A B C        | A C         | C → C        | different      |
| A and B are published      | A B C        | C, new base | C → C        | same, new base |
| C is discarded, read again | A B C        | A B         | C → B        | same as before |

So three questions get three answers:

| Question                                | Answered by                                   | Used by                            |
| --------------------------------------- | --------------------------------------------- | ---------------------------------- |
| Is this the same content?               | `chain`: a fold of the chain's patch ids      | caches, ETags, the page converging |
| Is this answer newer than that one?     | `seq`: bumped by every write, delete, publish | dropping answers that landed late  |
| What does my next write name as parent? | `headPatchId`, as today                       | `PatchSync`                        |

```ts
// packages/shared/src/internal/content/version.ts
export type ContentVersion = {
  /** schemaSha + Val's version: what the content is read with, by which engine. */
  code: string;
  /** sourcesSha + jsonEntriesSha (entry content is invisible to sourcesSha). */
  base: string;
  /** IDENTITY: a fold of the chain's patch ids, in order. */
  chain: string;
  /** ORDER only, never identity. */
  seq: number;
};

/** One module: its content depends on its base and ITS patches alone. */
export type ModuleVersion = { code: string; base: string; chain: string };

export function extendChain(prev: string, id: PatchId): string {
  return sha256Hex(`${prev}\n${id}`);
}

/** The cache key. `seq` is left out on purpose: it says when, not what. */
export function contentKey(v: ContentVersion | ModuleVersion): string {
  return `${v.code}:${v.base}:${v.chain}`;
}
```

The Studio can compute `chain` for its own optimistic content, because it is
only a fold of ids it holds. When the server confirms the same chain the keys
are equal and nothing re-renders.

`seq` exists in http mode already: the content service bumps `headVersion` on
every write, delete and commit, and `PatchSync` keeps the highest. fs mode
gets a counter in `.val/patches/seq`, written under the `patches.lock` every
append and delete already takes; memory mode a counter beside
`announceChange`.

### One engine

One function turns a module and a patch into a module, in
`@valbuild/shared` so it runs in the Studio, in Val's server and in the
demo's in-tab server. Module content and entry content are one state, so
`.jsonValues()` and file ops are handled once:

```ts
// packages/shared/src/internal/content/applyChain.ts
export type ModuleContent = {
  source: Json;
  /** `.jsonValues()` entries: content when loaded, ops waiting when not. */
  entries: Map<string, { content: Json } | { waiting: Operation[] }>;
};

export function applyPatchRecord(
  module: ModuleContent,
  record: PatchRecord,
  schema: SerializedSchema,
):
  | { status: "applied"; module: ModuleContent }
  | { status: "failed"; patchId: PatchId; message: string };
```

The rules it owns, each followed differently by today's two engines: where
a file's `patch_id` lands (the field's path plus `nestedFilePath`), what an
edit inside an entry does (applied to the entry, or held until it loads),
what a whole entry added does (a marker in the module, content in the entry),
and that a module's chain stops at its first failure.

Its callers: `SourceStore`, the head below, MCP, and `prepare`'s
`moduleVersions` (what content history records). `/save`'s rewrite of the
`.val.ts` text stays its own thing: it changes text, not content.

### One runtime per process, and the head

`valRuntime(valModules, config)` returns one runtime per process or isolate,
keyed on the `valModules` object so that HMR makes a new one. The API route,
the draft readers and MCP all use it, so a save moves every reader.

The runtime holds the **head**: the content at the newest chain. In a 128 MB
isolate it may only grow with what was edited, never with the site:

1. An unpatched module costs nothing: the head returns the bundle's own
   source object, which the isolate already holds for every visitor.
2. A module is materialized when it is read and has patches, never all at
   once.
3. A discard replays one module, from its base, through its own patches.
   There are no snapshots per chain position.
4. A byte budget with LRU eviction (16 MB, to be measured in phase 0). An
   evicted module is recomputed on the next read of it.
5. No validation and no previews on the read path. A draft render does what a
   page view does.

```ts
// packages/shared/src/internal/content/ContentHead.ts (sketch)
export class ContentHead {
  /** The chain, per module, in order. Ids only. */
  private byModule = new Map<ModuleFilePath, PatchId[]>();

  /** Moves to a chain. Touches no content: modules are computed when read. */
  move(chain: readonly ChainEntry[], seq: number): void;

  /** The bundle's object when unpatched; else cached, extended, or replayed. */
  module(
    path: ModuleFilePath,
  ): Promise<{ version: ModuleVersion; content: ModuleContent }>;
}
```

A draft read becomes a lookup:

```ts
const rt = await valRuntime(valModules, config);
const snap = await rt.draft();
return stegaEncode(selector, {
  disabled: false,
  getModule: (path) => snap.module(path)?.source,
  version: snap.version,
});
```

`/sources/~` answers with the version and an ETag of `contentKey`: content at
a version never changes, so the ETag is safe. Validation and previews become
their own requests.

The cost that is not free: in http mode the runtime needs a cheap "has the
chain moved?", that is `seq` alone, from a small content-service endpoint or
the WebSocket the Studio already has. Today `/stat` fetches the whole patch
list on every call.

### The page converges on the Studio

```ts
// packages/react/src/draft/converge.ts
export function shown(overlay: Held | undefined, server: Held): Held {
  if (overlay === undefined) return server;
  if (contentKey(overlay.version) === contentKey(server.version)) return server;
  return overlay;
}
```

The Studio's value for a module wins until a server render reaches the same
content. A refresh that lands before the server has the edit carries an older
chain and is not shown. A discard is not a problem: the Studio sees it on
`/stat` and sends a new value with the new chain.

When the page connects it reports its base per module, and the Studio sends
every module whose base differs, not only the ones it has patches for. That
fixes an unedited module staying stale on a site serving a content version.

### The Studio pulls

The Studio's content per module becomes the server's module at a version,
plus the Studio's own patches the server has not confirmed. The event is
`seq` moving on `/stat`; the pull is `/sources/~` for the modules whose
`ModuleVersion` changed, with the ETag. A module whose base is the bundle's
and has no patches needs no fetch.

This deletes BaseAlignment, `__VAL_BASE__` and the client's replay of other
sessions' patches: the server says what the chain is, and the Studio stops
reconstructing it. It needs the head and ETags first, so it comes late.

## Testing: scenarios and invariants

### What a scenario is

A scenario sets up a world, acts in it, and lets the invariants judge it:

```ts
// packages/scenarios/src/refreshRace.scenario.test.ts (the first scenario)
import { createWorld } from "./world";
import { homeVal } from "./fixtures/home";

describe.each(["memory", "fs"] as const)("on %s", (server) => {
  test("a refresh that lands before the write does not hide the edit", async () => {
    const world = await createWorld({
      modules: [homeVal],
      server,
      framework: "tanstack",
    });
    const studio = await world.studio("editor");
    const page = await world.page("/", {
      draftMode: true,
      in: { canvasOf: studio },
    });
    page.reads("loader", (val) => val.fetchVal(homeVal).title);
    page.reads("hook", (val) => val.useVal(homeVal).title);

    world.network.hold({ method: "PUT", path: "/patches" });
    studio.edit(homeVal, ["title"], "Hello world");
    await page.refresh(); // the race: the server does not have the edit yet
    world.network.release();
    await world.settle({ before: "safety-refresh" });

    world.expectInvariants(); // converged, never went back, one version per render
    expect(page.shows("loader")).toBe("Hello world");
  });
});
```

`describe.each` is the lever: every scenario runs in every mode the harness
can set up, so one script is three tests once http is in.

### What the world is made of

**The rule: the harness replaces the network and the clock, never Val's
code.** The same rule `createInTabValFetch` was built on, for the same
reason: a second implementation is something the product can drift from
while the tests stay green. `stores/testSystem.ts` has a fake server, which
is right for the stores' own tests and wrong here.

| Part              | Real code                                                                                                      | What the harness controls                               |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Server            | `ValServer` + `createValRequestHandler`, memory or fs (a temp dir); http against `e2e/mock-content-host` later | which mode; one patch store shared by every reader      |
| Network           | the Studio's `createValClient`, the page's requests                                                            | hold, release, delay, reorder, fail by route            |
| Studio            | `createValSystem` with in-process schema validation (`schemaValidation`)                                       | who the editor is; several editors                      |
| Page, server half | TanStack's `initValContent` readers, `draftMode` passed in                                                     | draft mode on or off; a refresh is a re-read            |
| Page, client half | `ValExternalStore` and the hooks' read path                                                                    | fed by the relay below                                  |
| Relay             | what `ValOverlayEmitter` / `CanvasFrame` send                                                                  | canvas or overlay                                       |
| Clock             | jest fake timers                                                                                               | `settle()` runs to quiet, or stops before a named timer |

Two seams have to be made, because today they only exist inside React
components: the relay (what `ValOverlayEmitter` sends, extracted to a
`createSourceRelay(system, send)` that the component calls) and the page's
refresh loop (`VAL_EDIT_LANDED`, the throttle and the safety refresh in
`ValTanStackProvider`, extracted to a `createRefreshLoop`). Extracting them is
part of phase 0. Mocking them would defeat the rule.

The package is `packages/scenarios`, private, because it depends on server,
shared, ui, react and tanstack together, which no published package may.

### The invariants

Every surface records a **frame** each time it shows a value: the surface,
the time on the fake clock, the value, and (from phase 1) the version.
`world.expectInvariants()` checks the log:

1. **Converges.** After `settle()`, every surface shows the same version of
   every module it reads, and that is the server's.
2. **Never goes back.** No surface shows a value, then a different one, then
   the first again, unless the chain went back in between (`seq` moved and
   `chain` returned to an earlier key).
3. **One version per render.** Every value a surface showed in one frame
   came from one version.
4. **Event, not timer.** `settle({ before: "safety-refresh" })` fails if
   converging needed the safety refresh.

A failure names the invariant, the surface and the frames that broke it, so
"the loader went back from 'Hello world' to 'Hello' at 512 ms" is the message
rather than a diff of two objects.

Until phase 1, frames carry values only, and invariants 1-3 compare values.
That is weaker (two versions can have equal values) but it is enough for the
first scenario.

### Why this scenario first

A refresh that lands before the server has the edit:

- **It is a known bug**, recorded in `architecture/quirks.md`, and today it is
  closed by a timer. The scenario is red on invariant 4 today, and phase 5
  makes it green without the timer. A first test that can fail is worth more
  than one that can only pass.
- **It needs every part of the world**: a server, a Studio, a page in draft
  mode with a server half and a client half, a relay, the network and the
  clock. If the harness can express this, it can express the scenarios after
  it.
- **It is small**: one module, one field, one edit.

### The scenarios after it

Each is a few lines once the world exists; the invariants are already there:

- A patch in the middle of the chain is discarded while the page shows it.
  The newest patch stays the same and the content changes, which is the case
  `chain` is for.
- Two editors on one module, and their `/stat` answers land out of order.
- A publish while the page is open in draft mode.
- A site serving a content version newer than its bundle, with an unedited
  module.
- An edit inside a `.jsonValues()` entry that neither the page nor the Studio
  has loaded.
- An upload, so `patch_id` has to reach the page where the file lands.
- A schema change (code mode): the `code` part of the version moves.

Later, the network can be driven by a seed: run the same scenario under many
orders of response arrival and keep the seed of any that fails.

## The phases

Each phase ships on its own and leaves everything working.

| #   | Phase                                                                                                                                                                                                                                                                                        | Repos     |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 0   | **The harness and the first scenario.** `packages/scenarios`, `createWorld` in memory and fs, the relay and refresh loop extracted, the invariants, the refresh-race scenario (red on invariant 4). Measure today's draft read and a prototype head in `workerd` at 128 MB.                  | val       |
| 1   | **Versions on the wire.** `ContentVersion` and `ModuleVersion`; `seq` in fs and memory; `/stat`, `/sources` and `PUT`/`DELETE /patches` answer with it; frames carry it. No behaviour changes.                                                                                               | val       |
| 2   | **One engine, server side.** `applyPatchRecord` in shared; `getSources`, `getSourcesWithPatchesApplied` and `prepare`'s `moduleVersions` switched over; conformance cases pass on both engines.                                                                                              | val       |
| 3   | **The Studio on the engine.** `SourceStore` applies through it; `substitutedSource` and `withFilePatchIds` go; the relay sends `{ version, source }`.                                                                                                                                        | val       |
| 4   | **One runtime and the head**, in 128 MB. Draft readers, MCP and `/sources/~` read it; ETags; validation and previews leave the read path; a cheap `seq` in http mode.                                                                                                                        | val, home |
| 5   | **The page converges.** `shown()`; the page reports its base per module and the Studio sends every module that differs; Next seeds its hooks at SSR and TanStack gets `draft` by default; `jsonEntryPromiseCache` keyed by version; the safety refresh goes. The first scenario turns green. | val       |
| 6   | **The Studio pulls.** The server's module at a version plus unconfirmed local patches, one pull on `seq`; BaseAlignment and `__VAL_BASE__` go; the code tools' `projectSource` keyed by version.                                                                                             | val       |
| 7   | **Clean up and document.** `architecture/content-versions.md`; `stores.md` and `quirks.md` updated.                                                                                                                                                                                          | val       |

Phases 2 and 3 can run beside phase 4 if phase 0 shows today's draft read
already crosses 128 MB. Each phase adds the scenarios it makes pass, and
http mode joins `describe.each` once `e2e/mock-content-host` can be started
in-process.

## Open questions

- **The http-mode head check.** A new content-service endpoint for `seq`, or
  `seq` from the WebSocket? The endpoint is simpler; the WebSocket is already
  open in the Studio but not in a page's server.
- **Next's server components.** A refresh is the only way an RSC changes, so
  `shown()` applies to client hooks there. Server-read content in Next needs
  the server to have the edit before the refresh: does the Studio tell the
  page when a write was confirmed (with its version), so the refresh is sent
  then and not before?
- **The budget.** 16 MB is a guess from home's measured 5× ratio; phase 0
  replaces it with a number.
- **React in the harness.** The plan extracts the relay and the refresh loop
  so most scenarios run without React. A scenario about hydration (phase 5)
  needs a render in jsdom; whether that lives in the same package is open.

## Appendix: the inventory

One line per place content is read, as of 2026-11-01. "The bundle" is the
app's own built `val.modules`: code, schema and the content as it was built.

**The app**

1. Next `fetchVal`, draft off: the bundle, in-process, no server call.
2. Next `fetchVal`, draft on: a private `ValServer` answers `PUT /sources/~` for the whole tree on every request, memoized per request by React `cache()`.
3. `fetchValKey` / `.jsonValues()` `fetchValRoute`, draft on: one in-process `GET /json` per call, not memoized; draft off, the bundle's `import()`.
4. `fetchValRouteUrl`: `fetchVal` on the whole router module, importing every entry to build one URL.
5. TanStack `fetchVal`, draft off: the bundle under the platform's snapshot (content version + proposal saves), built once per isolate.
6. TanStack `fetchVal`, draft on: as 2, with its own private `ValServer`, memoized per `Request`.
7. TanStack `fetchValDraft`: 6 trimmed to modules with patches, plus `/patches` and `/json` for touched entries, sent as loader data.
8. Client hooks during SSR and hydration (Next always, TanStack without `draft`): an empty store, so the bundle.
9. TanStack hooks with `draft`: seeded from 7 on server and browser; edit tags added the render after.
10. Client hooks without the Val Enable cookie: the bundle, no requests.
11. Client hooks with the overlay in draft mode: `ValExternalStore` fed by the Studio's events, holding only modules the Studio has changes for.
12. After an edit: `router.refresh()` / `router.invalidate()`, throttled to 500 ms, plus a safety refresh every 10 s; each redoes 2 or 6.
13. Client `useValKey` and route hooks outside draft mode: `import()`s in a module-level cache never invalidated.
14. The canvas: as 11, by `postMessage` through `ValCanvasBridge`; design frames get nothing, compare frames only `sourcesSynced`.
15. Demo: the canvas page gets content only by `postMessage` from the in-tab server.

**The Studio**

16. Base content and schema: `window.__VAL_MODULES__`, never `/schema`; TanStack's `__VAL_BASE__` replaces the content, not the schema.
17. The chain: ids from polled `/stat`, ops from `GET /patches`, applied by `SourceStore`.
18. BaseAlignment: another build's base from `PUT /sources/~?apply_patches=false`; content changes, schema stays.
19. `.jsonValues()` entries: `GET /json?apply_patches=false` on read; invalidated only by a rebase.
20. Previews and custom validation: the bundle's instances over the store, cached per module.
21. Schema validation: in a worker, keyed by schema version; "Check everything" asks the server's build.
22. Search and references: an in-process snapshot, staled per module on a patch, not on a schema change.
23. The assistant: content tools read the stores; code tools read `/project-source`, memoized for the hook's life.
24. The design tab: text files only, the proposal's against `/project-source`; its assistant reads the site's stores.
25. Quick preview: the proposal's files over the site's for the browser half; the server half is the last build.
26. Update from the site with code: three trees evaluated in workers; the server trusts what they report.
27. Compare with the site: `/proposal-site-sources` by raw `fetch`, walked with the proposal's schema.
28. History: a read-only system seeded from the live stores, the commit's modules laid over, an LRU of 20.
29. Restore: the old value from `/history/module`, checked against today's schema, written as a patch.
30. Publish: the gate validates from the stores; `/save` re-applies on the server; the managed build uses `/project-source`.

**Val's server**

31. Every `ValOps`: the app's imported modules, evaluated once per instance and memoized; only `/save` moves it.
32. Several instances per process, each with its own memo.
33. `/stat`: fs long-polls the log and file watches; http asks the content service each call; memory long-polls a signal.
34. `PUT /sources/~`: memo + the whole chain, fetched and applied each call; previews always; no cache.
35. `GET /patches`: the log, the content service or memory; no cache on Val's side.
36. `PUT /patches`: appended (fs ignores the parent) or posted with the parent (http); no validation.
37. `/files`: the patch directory or disk (fs), the content service (http); `max-age=0`.
38. `/save`: rewrites `.val.ts` text, no schema validation; records content + this build's schema.
39. History: module versions stored at each commit, immutable.

**Tooling**

40. `val validate`, `--fix`, `list-unused-files`: disk, evaluated in `node:vm`, no patches.
41. The language server: the same loader over unsaved buffers; dropped on any change.
42. The VS Code extension: runs the project's own language server.
43. MCP: the app's modules, patches applied and the index rebuilt every call; no content version or snapshot.
44. `val publish`: validates the checkout; with `--artifacts`, not what ships.
45. `val debug`: the local checkout's schema against the deployed commit's patches.

**The platform (valbuild/home)**

46. A site: the build's bundle plus the content version, handed in as env; the isolate keyed on both.
47. A proposal: the base build (or its own) plus the base's content version plus its overlay.
48. `/project-source`: KV `source:<project>`, which can be ahead of the live build.
49. Staging a `.val.ts`: new Source with the previous schema's sha.
50. Commits: content plus the schema of whichever build saved.
51. Proposal builds: the site's current source with the proposal's files over it.
