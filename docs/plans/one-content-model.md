# One content model: every reader, one version, one way to load

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

This plan reduces that to **one version** (which includes the code the
content belongs to), **one store** that holds modules by that version, **one
way to load** that `fetchVal`, `useVal` and the Studio all go through, and
**one engine** that turns patches into content. What differs between readers
is only where the data comes from and how they wait for it.

And it makes the result testable: a scenario sets up the world it runs in
(server mode, Studio, page, draft mode, network, clock, code) and is checked
against the same invariants as every other scenario, so adding an edge case is
a few lines and a broken invariant is caught by name.

## The goal

1. **The same version shows the same content everywhere.** The Studio, the
   page's server-read content and the page's hooks agree, or know they do not.
2. **No surface goes back.** Once a surface has shown an edit it never shows
   an older version, unless the chain really went back (a discard), and then
   it moves forward to the content without the edit.
3. **Content is never read with a schema it was not made for.** A code
   change is a version change, not new content quietly read with old code.
4. **Up to date, and cheap.** Changes arrive on events, not timers. A draft
   read costs what was edited, never the size of the site, and fits in a
   128 MB isolate.
5. **Testable with high confidence.** Every scenario sets up the environment
   it runs in, and every scenario is checked against the same invariants and
   the same budgets of work, so an edge case is a script of actions rather
   than new assertions.

## Why there are so many readers

Each reason is still true, and the design keeps serving it:

| Reason                                                                                    | What it forced                                                                |
| ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Typing cannot wait for a round trip                                                       | The Studio applies patches itself (`SourceStore`)                             |
| Schemas hold the author's closures (`validate`, `preview`), which cannot be sent anywhere | The schema instance always comes from the bundle, in the realm that runs it   |
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
  (`SchemaFreshnessWatch`) runs in the Studio only, and answers with a modal
  that reloads the page, which code mode, where schemas change with every
  build, cannot live with.
- **`fetchVal` and `useVal` repeat the same seven steps, four times.** Draft
  mode, where modules come from, which source wins, `.jsonValues()` entries,
  what to wait for, edit tags and errors are each written separately in
  Next's and TanStack's server and client readers, and twice more in the
  single-entry readers (`withJsonValuesEntries`, `draftJsonEntry`,
  `useDraftModuleSource`, `jsonEntryPromiseCache`).
- **Patches are applied by four implementations**: `SourceStore.applyEntries`,
  `ValOps.getSources`, MCP's `loadState` and `/save`'s `prepare`. The first two
  already disagree: the server skips an edit inside a `.jsonValues()` entry and
  writes `patch_id` into the source where a file lands; the Studio applies
  entry edits to the substituted module and stamps `patch_id` later, in the
  relay (`withFilePatchIds`).
- **A process holds up to four `ValOps`**, each with its own memo that only
  `/save` moves, and only for the instance that handled it: the API route,
  Next's RSC readers, TanStack's `initValContent` and MCP.
- **A draft read costs the whole site.** `fetchVal` in draft mode answers
  `PUT /sources/~` for every module and previews and validates all of them on
  every request (`ValServer.ts:2348-2373`). home measured validation at about
  5× the content's size in memory, and about 15 MB of content crosses 128 MB
  in an isolate (`docs/plans/upgrades-v2.md` in valbuild/home). That path has
  not been measured in an isolate; phase 0 does.
- **The page refreshes before the server has the edit**, and a safety refresh
  every 10 s catches it (`architecture/quirks.md`).
- **One Next page can show two versions**: server components the server's
  draft, client hooks the bundle until the overlay sends content.
- **Caches nothing invalidates**: the per-instance server memo,
  `jsonEntryPromiseCache`, and `projectSource` in the assistant's code tools.

Found on the way and not fixed here (each is its own small PR):

- `fetchVal`'s error fallback stega-encodes for every visitor, because it
  drops `disabled` (`packages/next/src/rsc/initValRsc.ts:231`, and the same in
  `packages/tanstack/src/server/initValContent.ts:271`).
- `/stat` sends `jsonEntriesSha` and nothing reads it.
- Compare with the site reads `/proposal-site-sources` with a raw `fetch`,
  not through `ValClient`.
- Staging a `.val.ts` in a proposal records its new Source with the previous
  schema's sha (`stagedModuleRows` in valbuild/home).
- MCP is not given the content version or the proposal's snapshot.

## The design

### 1. A version, per module, with the code in it

The newest patch cannot be the version, because the chain changes under it
(a discard in the middle leaves the newest patch where it was and changes the
content). And once code can change, the version has to say which code the
content belongs to. Each kind of change moves exactly one part:

| What changed                                      | Example                               | What moves                                                  |
| ------------------------------------------------- | ------------------------------------- | ----------------------------------------------------------- |
| A module's schema                                 | a field added to `home.val.ts`        | that module's `schema` (and `base` if its literals changed) |
| A module's content written in code                | the literal in `c.define(...)` edited | that module's `base`                                        |
| A `.val.json` entry file                          | an entry edited on disk               | that entry's `base`                                         |
| Code that is not content: components, routes, CSS | a new section component               | only `build`: the page reloads, nothing is refetched        |
| How patches are applied                           | `@valbuild/*` upgraded                | the engine, part of every `schema`                          |
| Content published without a build                 | a content-only publish                | `base` of the modules it published                          |
| An edit, a discard, a publish                     | typing in the Studio                  | that module's `chain`                                       |

```ts
// packages/shared/src/internal/content/version.ts
export type ModuleVersion = {
  /** sha(engine + serialized schema): what the content is read and patched with. */
  schema: string;
  /** sha(the module's base source): from the build, a content version or history. */
  base: string;
  /** A fold of this module's patch ids, in order: IDENTITY of the chain. */
  chain: string;
};

export type ProjectVersion = {
  /** The build serving it: buildInputId when hosted, a hash of the module files in dev. */
  build: string;
  /** ORDER only: bumped by every write, delete, publish and new build. */
  seq: number;
};

export function extendChain(prev: string, id: PatchId): string {
  return sha256Hex(`${prev}\n${id}`);
}

/** The address of a module's content. Never changes meaning. */
export function moduleKey(path: ModuleFilePath, v: ModuleVersion): string {
  return `${path}@${v.schema}.${v.base}.${v.chain}`;
}
```

Three questions, three answers: _is this the same content?_ is `moduleKey`;
_is this answer newer?_ is `seq` (the content service already bumps
`headVersion` on every write, delete and commit; fs mode gets a counter in
`.val/patches/seq` under the existing `patches.lock`, memory mode one beside
`announceChange`); _what does my next write name as its parent?_ stays
`headPatchId`.

The Studio can compute the version of its own optimistic content, because
`chain` is a fold of ids it holds. When the server confirms the same chain the
keys are equal and nothing re-renders.

Today's SHAs are folds over the whole project (`computeSchemaSha`,
`computeSourcesSha`). They become per module, and the fold over them is what
tells a reader that something moved.

### 2. The store: one address, immutable values, tiers

Content at a version never changes, so a store of modules by `moduleKey` needs
no invalidation, only eviction. Every place uses the same store, with the
tiers that fit it:

```ts
// packages/shared/src/internal/content/moduleStore.ts
export type StoredModule = { version: ModuleVersion; content: ModuleContent };

export interface ModuleTier {
  readonly name: string; // "memory" | "bundle" | "origin" | …: goes into test frames
  get(key: string): StoredModule | null | Promise<StoredModule | null>;
  put?(key: string, value: StoredModule, bytes: number): void;
}

/** Asks each tier in turn; what a slower tier answers is written to the faster ones. */
export function tiered(tiers: readonly ModuleTier[]): ModuleTier;

/** Bounded by bytes; keeps the last N versions per module path. */
export function memoryTier(opts: {
  budgetBytes: number;
  lastPerModule: number;
}): ModuleTier;

/** The build's own modules, free: answers only keys whose version is the bundle's. */
export function bundleTier(valModules: ValModules): ModuleTier;
```

- **A base is a version with an empty chain.** The same store holds both, so
  "the base" stops being a separate concept with its own path
  (`__VAL_BASE__`, BaseAlignment's fetched base, the snapshot).
- **The last N versions per module** are a small ring per path inside the
  memory tier's byte budget. N = 2 covers the current version and the one
  before it (a discard, an answer that lands late). Older ones are recomputed
  from their base and chain.
- **`.jsonValues()` entries are stored as modules of their own**, under the
  record's schema, so a large record is not copied because one entry changed.

| Place                      | Tiers, fastest first                                                       |
| -------------------------- | -------------------------------------------------------------------------- |
| Val's server, node         | memory → bundle → the head computes from base + chain                      |
| A site's isolate (128 MB)  | memory (budgeted) → bundle → content version (today's handover) → the head |
| The content service (home) | blobs by `source_sha` / `schema_sha` (`val_module_versions`, exists)       |
| The Studio                 | memory → bundle (a prefill) → origin: **its own server, one endpoint**     |
| The page in the browser    | the overlay (reads from the Studio) → bundle                               |

A Cache API tier in the isolate, to keep the head across isolate restarts, is
left out unless phase 0 shows restarts are frequent enough to matter.

### 3. One engine

One function turns a module and a patch into a module, in `@valbuild/shared`
so it runs in the Studio, in Val's server and in the demo's in-tab server:

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

It owns the rules today's two engines follow differently: where a file's
`patch_id` lands (the field's path plus `nestedFilePath`), what an edit inside
an entry does (applied to the entry, or held until it loads), what a whole
entry added does (a marker in the module, content in the entry), and that a
module's chain stops at its first failure.

It applies copy-on-write along the patch's path instead of today's
`applyPatch(deepClone(module))`, so a patch costs the depth of its path rather
than the module's size, and an unchanged subtree keeps its identity (which
makes "did this path change?" a `===`). `stores.md` records a copy-on-write
bug in `.jsonValues()` substitution that took a page down, so this gets its
own conformance cases.

Callers: the Studio's local edits, the head, MCP, and `prepare`'s
`moduleVersions` (what content history records). `/save`'s rewrite of the
`.val.ts` text stays its own thing: it changes text, not content.

### 4. One way to load: sources, `layered`, `resolveVal`

Only two things differ between readers: **where the data comes from** and
**how they wait** (`await` on the server, `React.use` in a component, `peek`
then `get` in the Studio). Everything else is shared.

```
          fetchVal (server)            useVal (browser)             the Studio
                │                            │                          │
 differs:       │ request env                │ provider env             │ manifest + store
                ▼                            ▼                          ▼
 sources: [serverDraft, snapshot,   [overlay, seeded,          withLocalEdits(
           bundle]                   snapshot, bundle]           [manifest, bundle])
                └────────────────────────────┼──────────────────────────┘
 the same:                     layered(sources)     which source wins, the schema rule
                               planOf(selector)     which modules and entries
                               resolveVal(...)      → ready (with versions) | pending
                └────────────────────────────┼──────────────────────────┘
                ▼                            ▼                          ▼
          await, resolve again      React.use, render again    SourceStore.peek / get
```

Every source answers in one shape:

```ts
// packages/react/src/read/source.ts
export type ModuleRead =
  | { status: "ready"; version: ModuleVersion; source: Json; from: string }
  | { status: "pass" } // no say here: ask the next source
  | { status: "pending"; ready: Promise<void> }; // will have a say: wait

export interface ContentSource {
  readonly name: string;
  module(path: ModuleFilePath): ModuleRead;
  entry(path: ModuleFilePath, key: string): EntryRead; // the same, plus "gone"
  subscribe?(
    paths: readonly ModuleFilePath[],
    onChange: () => void,
  ): () => void;
}
```

The sources:

- `bundleSource(valModules)`: always has a say. Entries are its own
  `import()`s, kept by version (which replaces `jsonEntryPromiseCache`).
- `snapshotSource(snapshot)`: the platform's content version and proposal
  saves, for the modules it has.
- `serverDraftSource(runtime, session)`: the head, in-process, on the page's
  server in draft mode. Unpatched modules pass, so the bundle answers them.
- `overlaySource(store, state)`: the browser's store, fed by the Studio. The
  three suspend gates (`quirks.md`, "`suspend` is three waits") become its
  states: pass until hydrated or with draft mode off, pending while draft mode
  is unknown or while the Studio has not sent everything, ready for what it
  holds, pass for what the Studio says it has nothing for.
- `seededSource(draft)`: what the server read for this page, so SSR and
  hydration agree.
- `manifestSource(manifest, store)`: the Studio's, below.

`layered(sources)` is the only place that decides which source wins (the
first that does not pass), and the only place that applies the code rule:

```ts
// in layered: content is only read with the schema it was made for
if (r.status === "ready" && r.version.schema !== ownSchemaVersion(path)) {
  return { status: "pending", ready: codeChanged(path, r.version.schema) };
}
```

`layered` also gives `revision(paths)`: a string that changes exactly when a
read would, built from the keys that already exist. `useSyncExternalStore`
compares it with `===`, so reference stability comes from versions rather
than from memoising objects.

`resolveVal(selector, env)` is what happens after loading, for every reader:
it reads the modules and entries `planOf(selector)` names from the view,
fills `.jsonValues()` records, returns `pending` with one promise if anything
is pending, and otherwise `stegaEncode`s and returns the value with the
version and source of every module it read. The single-entry readers
(`fetchValKey`, `useValKey`, the route readers) are a different plan through
the same function.

The readers are then what is left to differ:

```ts
// server
export function initFetchVal(env: { forRequest(): Promise<ReadEnv> }) {
  return async function fetchVal<T extends Resolvable>(
    selector: T,
  ): Promise<ResolvedVal<T>> {
    const readEnv = await env.forRequest(); // cookie, session: the only server-specific part
    for (;;) {
      const r = resolveVal(selector, readEnv);
      if (r.status === "ready") return r.value;
      await r.ready;
    }
  };
}

// browser
export function useVal<T extends Resolvable>(selector: T): ResolvedVal<T> {
  const env = useReadEnv(); // the provider's: layered([overlay, seeded, snapshot, bundle])
  const plan = planOf(selector);
  React.useSyncExternalStore(
    React.useCallback(
      (cb) => env.view.subscribe?.(plan.modules, cb) ?? (() => {}),
      [env, plan],
    ),
    () => env.view.revision(plan.modules),
    () => env.view.revision(plan.modules),
  );
  const r = resolveVal(selector, env);
  if (r.status === "pending") React.use(r.ready);
  return r.status === "ready" ? r.value : unreachable();
}
```

`encode` (edit tags) is part of the env, decided once from draft mode, so an
error on the way can no longer drop it.

### 5. The Studio loads everything from one place

The Studio asks its own server two things: **what** (the manifest) and **the
content** (modules by address). The bundle is a prefilled tier, used when an
address matches, and the place schema closures come from; it is no longer a
second source of content.

```ts
// GET /api/val/manifest: what /stat answers, per module. Own ETag, and "since seq N".
type Manifest = {
  project: ProjectVersion;
  modules: Record<ModuleFilePath, ModuleVersion>;
};

// GET /api/val/modules/<path>?v=<moduleKey>[&have=<moduleKey>]
// Cache-Control: immutable. With `have`, the patches from `have` to `v` when
// the server can, else the whole module.
type ModuleAnswer =
  | { kind: "module"; version: ModuleVersion; content: ModuleContent }
  | {
      kind: "delta";
      from: ModuleVersion;
      to: ModuleVersion;
      patches: PatchRecord[];
    };
```

```ts
// packages/ui/spa/stores/studioView.ts
const store = tiered([
  memoryTier({ budgetBytes: 64 * MB, lastPerModule: 2 }),
  bundleTier(window.__VAL_MODULES__),
  originTier(client), // GET /modules/…, with `have` from the memory tier
]);
const view = withLocalEdits(
  layered([manifestSource(manifest, store)]),
  () => patchStore.unconfirmed(), // written here, not yet in the server's chain
  engine,
);
```

`withLocalEdits` is the one layer only the Studio has, because only the
Studio writes and typing cannot wait: it applies the Studio's unconfirmed
patches with the engine on top of what the server answered, and extends the
version's `chain` by their ids. It keeps its result per (version below, ids
applied) and extends it by the new patch only.

`SourceStore` sits on top of the view and keeps what `stores.md` describes,
because those rules are about fields, not loading: `peek` and `get` (`pending`
is what `get` waits for), wake-ups per path, a field never woken by its own
edit, previews and custom validation from the bundle's schema instances. What
changes: `peek` is reference-stable by key (same version and path, same
object) rather than by recompute-and-compare.

The relay sends the page exactly what the view answered (`{ path, read }`,
built by a `createSourceRelay(view, send)` extracted from
`ValOverlayEmitter`), and the page's `overlaySource` stores it as is. The page
reports its base per module when it connects, and the Studio sends every
module whose base differs, not only the ones it has patches for.

This deletes BaseAlignment, `__VAL_BASE__`, the client's replay of other
sessions' patches, `substitutedSource` and `withFilePatchIds`.

Until the head and the module endpoint exist (phase 6), the Studio runs
today's behaviour as a source, `chainSource` (the bundle plus the whole chain,
replayed in the browser with the engine), so its consumers move onto the view
early and the later switch is one line.

### 6. One runtime per process, and the head

`valRuntime(valModules, config)` returns one runtime per process or isolate,
keyed on the `valModules` object so HMR makes a new one. The API route, the
draft readers and MCP all use it, so a save moves every reader. It is built
with the content version and the proposal like everything else, which fixes
MCP's base.

The runtime holds the **head**: the content at the newest chain, in the
module store. In a 128 MB isolate it only grows with what was edited:

1. An unpatched module costs nothing: the bundle tier answers with the
   bundle's own object, which the isolate holds for every visitor anyway.
2. A module is materialized when it is read and has patches, never all at
   once.
3. A discard replays one module from its base through its own patches.
4. The memory tier's byte budget (16 MB, to be measured in phase 0) evicts the
   least recently read module, which is recomputed on its next read.
5. No validation and no previews on the read path. They become their own
   requests.

One head serves every editor: draft content is not per user, and the session
only decides who may see it.

In http mode the runtime needs a cheap "has the chain moved?", `seq` alone,
from a small content-service endpoint or pushed. Today `/stat` fetches the
whole patch list on every call.

### 7. How code changes travel

| Reader     | A module's schema changed                                                                                                                                                                             | Only `build` changed |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| The Studio | `reloadCode` puts the new schema instances in place, from HMR in dev or from the build's registry entry when hosted; no dialog, no page reload ([below](#reloading-the-schema-while-the-studio-runs)) | nothing to refetch   |
| The page   | reload: its own code is the old build                                                                                                                                                                 | reload               |
| `fetchVal` | cannot happen: the runtime is the build, and a new build is a new runtime                                                                                                                             | —                    |

- **Local dev.** Editing `home.val.ts` makes a new `valModules` (HMR), a new
  runtime, and a manifest where only `/home.val.ts` has a new `schema` and
  `base`. Nothing else is refetched.
- **Code mode, before a build.** A staged `.val.ts` has text but no evaluated
  schema, so its version is `schema = "staged:<inputs hash>"`, which no reader
  has: its content is pending ("build to see it") rather than read with the old
  schema. The design tab's evaluation in the browser (`design-tab.md` §3 in
  valbuild/home) or a quick preview can give the real schema sha. Home's
  staging bug becomes impossible to write: it is a version claiming a schema
  it was not made with.
- **Code mode, after a build.** The proposal's address serves a new build, so
  a new runtime; modules whose `.val.ts` changed get new addresses, and the
  rest keep theirs.
- **A content-only publish.** `base` moves for what it published; `build`
  does not.

### 8. The page converges on the Studio

The overlay is the first source in the page's view, so a refresh that brings
an older server draft never wins over the Studio's value for that module. When
the server's render reaches the same `moduleKey`, it is the same content and
nothing changes on screen.

Server-read content (a loader, a server component) only changes on a refresh,
so the refresh has to be sent when the server has the edit, not when it is
typed: the Studio sends the page "confirmed up to this version" when
`PatchSync` has it confirmed, and the page refreshes then. That replaces the
safety refresh and its throttle.

Next seeds its hooks at SSR the way TanStack's `draft` does, and TanStack gets
`draft` by default rather than needing the app to wire `fetchValDraft` into its
loader, so published content no longer flashes before the draft.

## Testing

**The rule: tests replace the network, the clock and nothing else of Val's.**
The same rule `createInTabValFetch` was built on: a second implementation is
something the product drifts from while the tests stay green.

### Three levels

1. **The shared pipeline, with scripted sources.** `layered`, `resolveVal`,
   `withLocalEdits` and the engine are the same code for every reader, so an
   edge case here is tested for all of them: a pending overlay that resolves
   (and the bundle's value never shown in between), an entry that is gone, a
   module whose schema differs. Scripted sources are allowed at this level
   because `ContentSource` is the boundary.
2. **One contract per real source and tier.** Given this state, the source
   answers pass, pending or ready; a tier answers this key or nothing. For
   example: an edit the server confirmed is not applied twice by
   `withLocalEdits`, and its version is the same as the optimistic one.
3. **Scenarios: the real code, the whole world.**

### A scenario

```ts
// packages/scenarios/src/refreshRace.scenario.test.ts
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

    studio.reads("field", homeVal, ["title"]); // SourceStore.peek, as a field does
    page.reads("loader", (val) => val.fetchVal(homeVal).title); // the real fetchVal
    page.reads("hook", (val) => val.useVal(homeVal).title); // the real useVal, rendered in jsdom

    world.network.hold({ method: "PUT", path: "/patches" });
    studio.edit(homeVal, ["title"], "Hello world");
    await page.refresh(); // the race: the server does not have the edit yet
    world.network.release();
    await world.settle({ before: "safety-refresh" });

    world.expectInvariants();
    world.expectWork({
      "engine:apply-patch": { atMost: 2 },
      "origin:fetch-module": { atMost: 1 },
    });
  });
});
```

| Part              | Real code                                                                                                      | What the harness controls                             |
| ----------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Server            | `ValServer` + `createValRequestHandler`, memory or fs (a temp dir); http against `e2e/mock-content-host` later | the mode; one runtime shared by every reader          |
| Network           | the Studio's `createValClient`, the page's requests                                                            | hold, release, delay, reorder, fail by route          |
| Studio            | `createValSystem` with in-process schema validation                                                            | who the editor is; several editors                    |
| Page, server half | the real `fetchVal` with its request env                                                                       | draft mode on or off; a refresh is a re-read          |
| Page, client half | the real `useVal`, rendered with `renderHook` in jsdom                                                         | hydrated or not                                       |
| Relay             | `createSourceRelay`, extracted from `ValOverlayEmitter`                                                        | canvas or overlay                                     |
| Refresh loop      | `createRefreshLoop`, extracted from `ValTanStackProvider`                                                      | —                                                     |
| Clock             | jest fake timers                                                                                               | `settle()` to quiet, or stopping before a named timer |
| Code              | a new `valModules`, as HMR or a new build makes                                                                | `world.changeCode(module, schema)`                    |

`describe.each` is the lever: every scenario runs in every mode the harness
can set up. The package is `packages/scenarios`, private, because it depends on
server, shared, ui, react and tanstack together.

### The invariants

Every surface records a frame each time it shows a value: surface, time on
the fake clock, value, the source that answered, and the version.
`world.expectInvariants()` checks:

1. **Converges.** After `settle()`, every surface shows the server's version
   of every module it reads.
2. **Never goes back**, unless the chain went back (`seq` moved and `chain`
   returned to an earlier key).
3. **One version per render.**
4. **Parity.** The same versions give the same value, whether read through
   `fetchVal`, `useVal` or a Studio field.
5. **Never with another schema.** No surface shows content whose `schema` is
   not the schema it read it with.
6. **Events, not timers.** `settle({ before: "safety-refresh" })` fails if
   converging needed the safety refresh.
7. **No dialog about the schema.** A schema change, however often it happens,
   never stops the editor (see
   [Reloading the schema](#reloading-the-schema-while-the-studio-runs)).

A failure names the invariant, the surface, the source and the frames:

```
✕ never goes back: "loader"
    120 ms  "Hello"        from bundle        chain —
    640 ms  "Hello world"  from server-draft  chain k1
    700 ms  "Hello"        from server-draft  chain k0   ← older chain, after k1 was shown
```

Until phase 1, frames carry values only and the invariants compare values,
which is weaker but enough for the first scenario.

### Budgets of work, counted

Performance is checked by **counting work, not timing it**, so CI can run it
deterministically. The stores already do this: `RecordingActivity` counts
`source:clone-module` and `source:apply-patch` so that "a redundant clone and
a redundant apply are different bugs". The harness reads the same channel, so
"a keystroke applies one patch, clones nothing outside its path and wakes one
field" is an assertion (`world.expectWork`). Wall-clock numbers live in phase
0's benchmark, run separately and recorded in `architecture/`.

### The first scenario, and why

A refresh that lands before the server has the edit: a known bug
(`architecture/quirks.md`) closed today by a timer, so the scenario is red on
"events, not timers" and turns green in phase 4. It needs every part of the
world (server, Studio, a page with a server half and a client half, relay,
network, clock), so a harness that can express it can express the rest. And it
is small: one module, one field, one edit.

### The scenarios after it

- A patch in the middle of the chain is discarded while the page shows it (the
  newest patch stays the same and the content changes).
- Two editors on one module; their `/stat` answers land out of order; the
  pull answers with deltas (`origin:pull-bytes` budgeted).
- A publish while the page is open in draft mode.
- A site serving a content version newer than its bundle, with an unedited
  module.
- An edit inside a `.jsonValues()` entry that neither the page nor the Studio
  has loaded.
- An upload, so `patch_id` reaches the page where the file lands.
- A schema change while the page shows an edit (`world.changeCode`): only that
  module is refetched, and nothing is read with the old schema.
- A gallery-backed field whose gallery changes (its schema names the gallery
  by path, so its `schema` must not move).

Later, the network can be driven by a seed: the same scenario under many
orders of response arrival, keeping the seed of any that fails.

## Performance risks

| #   | Risk                                                                                      | New or today?        | What to do                                                                | Budget                                 |
| --- | ----------------------------------------------------------------------------------------- | -------------------- | ------------------------------------------------------------------------- | -------------------------------------- |
| 1   | Pulling a whole module after another editor's keystroke (today only the patch comes down) | **New**              | The module endpoint answers with a delta from `have` when it can          | `origin:pull-bytes`                    |
| 2   | `withLocalEdits` re-applying every unconfirmed patch on every read                        | New                  | Keep the result per (version below, ids applied); extend by the new patch | `engine:apply-patch` per keystroke = 1 |
| 3   | Hashing on reads                                                                          | New                  | Versions are computed when content changes, never when it is read         | `version:hash` per read = 0            |
| 4   | The engine cloning the whole module per patch                                             | Today                | Copy-on-write along the patch's path                                      | `engine:clone-bytes`                   |
| 5   | Wake-ups after a pull, which does not say which paths changed                             | New                  | `===` per path, thanks to copy-on-write; or the paths from the delta      | `store:wake`                           |
| 6   | `stegaEncode` on every render                                                             | Today                | Memoize `resolveVal` per (selector, `revision`, `encode`)                 | `stega:encode` per render              |
| 7   | "Has the chain moved?" per draft request in http mode                                     | Today, cheaper after | `seq` alone, or pushed; one head per isolate for every editor             | phase 0 benchmark                      |
| 8   | The relay sending the whole module per change, compared with `deepEqual`                  | Today                | Compare `moduleKey`; send deltas later                                    | `relay:bytes`                          |
| 9   | Browser memory: every pulled version kept                                                 | New                  | The last two per module                                                   | heap guard                             |
| 10  | The manifest's size (~30 KB for 200 modules)                                              | New                  | Its own ETag and "since `seq` N"; a quiet project sends nothing           | `manifest:bytes`                       |
| 11  | The isolate's 128 MB                                                                      | Today                | The head grows with edits only; validation leaves the read path           | phase 0 benchmark                      |

Risk 1 decides the design rather than adding work to it: without the delta,
pulling makes collaboration more expensive than it is today.

## The phases

Each phase ships on its own and leaves everything working. Each adds the
scenarios it makes pass.

### Each phase deletes what it replaced

The point of the plan is fewer paths, so old and new never live side by side
longer than one PR. A phase is not done while the code it replaced is still
there; there is no flag to choose between the two, and no "remove later".

- **Behaviour first, then deletion.** What the old code did is pinned by a
  scenario or a contract test before it goes. A unit test of deleted code is
  deleted with it; a behaviour it pinned moves to a scenario first. (The rule
  "never fix an issue by changing the test file" still holds: this is moving
  what a test checks, not loosening it.)
- **What may not simply be deleted:**
  - **The public API** of `@valbuild/*`: `fetchVal`, `useVal`, the key and
    route readers, `ValProvider`, `ValModulesClient` keep their signatures. An
    export that has to go is `@deprecated` for a release first, as
    `s.imageset` was.
  - **The wire to the content service.** home deploys on its own schedule, so
    a field Val stops reading stays optional on the wire until home stops
    sending it, and a new field is optional until home sends it (as
    `headPatchId` and `headVersion` are).
  - **A deployed Studio against a newer server**, for the length of a
    deploy: a `/stat` answer keeps what an older Studio reads until the
    manifest has replaced it for a release.
- **Each phase lists what it deletes**, below, so a review can check the
  deletion happened rather than trust it.

| #   | Phase                                                                                                                                                                                                                                                                                                                                                                                                                   | Repos     |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------- |
| 0   | **The harness and the first scenario.** `packages/scenarios`; `createWorld` in memory and fs; `createSourceRelay` and `createRefreshLoop` extracted; the invariants and counted budgets; the refresh-race scenario (red). Measure today's draft read and a prototype head in `workerd` at 128 MB.                                                                                                                       | val       |
| 1   | **Versions on the wire.** `ModuleVersion` (`schema`, `base`, `chain`) and `ProjectVersion` (`build`, `seq`); per-module SHAs; `seq` in fs and memory; the manifest with its ETag; every answer and frame carries a version. No behaviour changes.                                                                                                                                                                       | val       |
| 2   | **One engine, server side.** `applyPatchRecord` in shared, copy-on-write; `getSources`, `getSourcesWithPatchesApplied` and `prepare`'s `moduleVersions` switched over; conformance cases pass on both engines.                                                                                                                                                                                                          | val       |
| 3   | **The readers on sources.** `ContentSource`, `layered` (with the schema rule), `planOf`, `resolveVal`; the bundle, snapshot, overlay and seeded sources; `fetchVal`, `useVal` and the key and route readers of both frameworks on them; the relay sends reads. Removes the duplicated copies and the error-path bug.                                                                                                    | val       |
| 4   | **The page converges.** Overlay first; "confirmed up to this version" triggers the refresh; the page reports its bases and the Studio sends what differs; Next seeds hooks at SSR and TanStack gets `draft` by default; the safety refresh goes. The first scenario turns green.                                                                                                                                        | val       |
| 5   | **The Studio on the view.** `withLocalEdits` over `chainSource` (today's behaviour as a source); `SourceStore` on top, reference-stable by key; `substitutedSource` and `withFilePatchIds` go.                                                                                                                                                                                                                          | val       |
| 6   | **The store, the runtime and the head.** `tiered`, `memoryTier`, `bundleTier`; `valRuntime` per process; the head in the store; `serverDraftSource`; `GET /modules` with deltas; validation and previews leave the read path; a cheap `seq` in http mode. Within 128 MB.                                                                                                                                                | val, home |
| 7   | **The Studio loads from one place.** `manifestSource` and `originTier` replace `chainSource`; BaseAlignment and `__VAL_BASE__` go; the code tools' `projectSource` keyed by version; staged schemas (`staged:<hash>`) in code mode.                                                                                                                                                                                     | val, home |
| 8   | **Document.** `architecture/content-versions.md`; `stores.md` and `quirks.md` updated; anything a phase could not delete in its own PR (only the wire and deprecations above), with the release it goes in.                                                                                                                                                                                                             | val       |
| 9   | **Reloading the schema while the Studio runs.** See [the section below](#reloading-the-schema-while-the-studio-runs): one `reloadCode(registry)` for HMR and for a new build; a registry entry per build, named in the manifest; replaced, not merged; a registry that does not load leaves the Studio on the old one; edits that no longer apply are held, not deleted; `SchemaFreshnessWatch` and its dialog deleted. | val, home |

What each phase deletes (to be checked against the code when the phase
starts; the names are as of 2026-11-01):

| #   | Deleted in the same PR                                                                                                                                                                                                                                                                                                                                                      |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0   | Nothing; the relay and the refresh loop MOVE out of `ValOverlayEmitter`, `ValTanStackProvider` and `ValNextProvider` into plain functions the components call. Moved, not copied.                                                                                                                                                                                           |
| 1   | Nothing: it only adds to the wire.                                                                                                                                                                                                                                                                                                                                          |
| 2   | The patch rules in `ValOps.getSources` and `getSourcesWithPatchesApplied`; the replay in `applyJsonValuesEntryPatches`; `deepClone` per patch.                                                                                                                                                                                                                              |
| 3   | `withJsonValuesEntries` (Next and TanStack), `draftJsonEntry`, `useDraftModuleSource`, `committedJsonEntryPromise`, `jsonEntryPromiseCache`; the inline source-priority arrays; the suspend gates in both `initValClient`s; the error-path `stegaEncode`; the two `useValStega` copies, which become one in `@valbuild/react`.                                              |
| 4   | The safety refresh (`safetyRefresh.ts` in both packages, `SAFETY_REFRESH_MS`, `SAFETY_REFRESH_WINDOW_MS`) and the 500 ms throttle around it.                                                                                                                                                                                                                                |
| 5   | `SourceStore`'s own patch rules in `applyEntries`; `substitutedSource`; `withFilePatchIds`; peek stability by recompute-and-compare.                                                                                                                                                                                                                                        |
| 6   | The private `createValServer` in `initValRsc` and in `initValContent`, and MCP's `createOpsResolver`; `loadDraftSources`; `createReactCacheScope` and `createTanStackRequestScope`; the per-call `/json` in the key readers; `fetchValDraft`'s extra `/patches` and `/json`; whole-tree previews and validation in `PUT /sources/~`; MCP's rebuild per call in `loadState`. |
| 7   | `BaseAlignment`; `__VAL_BASE__`; the Studio's `PUT /sources/~?apply_patches=false`; `chainSource`; the client's replay of the chain and its reconciliation of patches that vanished from `/stat`; the code tools' `projectSource` memo.                                                                                                                                     |
| 9   | `SchemaFreshnessWatch`, `StatusStore.reportSchemaOutOfDate` and the dialog; the merge in `SchemaStore.receive`.                                                                                                                                                                                                                                                             |

Phase 2 can run beside phases 3 and 4. Phase 6 moves ahead of 2–5 if phase 0
shows today's draft read already crosses 128 MB. http mode joins
`describe.each` once `e2e/mock-content-host` can be started in-process.

## Open questions

- **The http-mode `seq`.** A new content-service endpoint, or pushed over the
  WebSocket? The endpoint is simpler; the WebSocket is open in the Studio but
  not in a page's server.
- **Next's server components** only change on a refresh. "Confirmed up to this
  version" covers the edit; does it also need to cover another editor's
  change, or is that the next refresh's job?
- **Staged schemas.** Content under `staged:…` is unreadable until something
  evaluates the proposal's code. Whether the browser evaluation of
  `design-tab.md` §3 is in scope decides how long code mode's content waits.
- **The budgets.** 16 MB for the isolate's head and 64 MB for the Studio's
  memory tier are guesses; phase 0 replaces them with numbers.
- **React in the harness.** `useVal` is thin enough to render with
  `renderHook`; whether hydration scenarios (phase 4) live in the same package
  is open.

## Reloading the schema while the Studio runs

The schema a reader uses is an INSTANCE from the bundle: it carries the
author's closures (`validate`, `preview`, `render`), so it cannot come from the
server as data. The version tells the Studio that a module's schema changed
(section 7); something then has to put the new instance in place without
reloading the page, or code mode reloads the Studio after every build and
takes the chat, the unsaved edits and the navigation with it.

### What exists today

- **In dev, HMR swaps the registry.** `<ValModulesClient>` sets
  `window.__VAL_MODULES__` and dispatches `val-modules-updated`;
  `useValModules` hands the new registry to `HostStore.receive`, which
  serializes the new schemas and keeps the new instances.
- **But it merges.** `SchemaStore.receive` does
  `{ ...this.schemas, ...schemas }`, so a module removed from `val.modules`
  stays in the Studio until a reload. According to the inventory, search and
  references are not marked stale on `schema:init` either (to confirm).
- **When hosted, the only answer is a full reload.** `SchemaFreshnessWatch`
  compares the schema this page runs with the server's, and shows a one-way
  dialog that reloads the page.

### What it should be

**One function, whatever brought the new code:**

```ts
// packages/ui/spa/stores/HostStore.ts
type CodeReload =
  | { status: "reloaded"; changed: ModuleFilePath[]; removed: ModuleFilePath[] }
  | { status: "kept"; reason: "does-not-load" | "other-val-version" | "not-the-manifest's"; details: string };

/**
 * Replaces the schema instances in one turn: serialized schemas, instances,
 * and the per-module schema versions the sources compare against. Only the
 * modules whose schema version moved are touched; a module no longer in the
 * registry is removed, not kept.
 */
reloadCode(registry: ValModules, expected: Manifest): Promise<CodeReload>;
```

**Where the new registry comes from:**

- **Dev:** HMR, as today. `val-modules-updated` calls `reloadCode` instead of
  `receive`.
- **A new build, hosted** (a publish with code, or a proposal built in code
  mode): every build emits its `val.modules` registry as an entry of its own,
  `/_val/modules/<build>.js`, an ES module whose default export is the
  registry, importing the build's own chunks. The manifest names it
  (`project.modulesEntry`), and the Studio `import()`s it when `build` moves
  and a module's `schema` moved with it. The build step is
  `@valbuild/tanstack-build` (and the Next plugin), which is where the
  platform's builds come from.
- **A build whose `@valbuild/*` versions differ from the Studio's own** (an
  upgrade proposal) cannot be swapped in: the Studio's own code is part of
  what changed, and old stores would run against a new core. `reloadCode`
  answers `other-val-version`, and the Studio reloads itself, without asking:
  it waits until no write is in flight (`PatchSync` idle), and the reload
  loses nothing, because where the editor is and the chat session are in the
  URL and every edit is on the server. Until then, the modules whose schema
  moved are `pending` like any other, with "Val was updated in this proposal"
  as the reason. This is rare (once per upgrade), not once per build.

**The dialog goes.** In code mode a schema changes every time the assistant
builds, so a modal that stops the editor and reloads the page cannot be how a
schema change arrives. `SchemaFreshnessWatch`, `StatusStore.reportSchemaOutOfDate`
and the dialog behind them are deleted in phase 9. What the watch knew is
kept, in the places that now own it:

- _A tab can load a new bundle and be answered by the old build for a while_
  (the platform's pointer lags per location): `reloadCode` only adopts a
  registry whose versions equal the manifest's, so a manifest from the old
  build is simply not adopted.
- _During a deploy the old and the new build both answer, and the last answer
  to land is not the newest_: `seq` orders them, and an older answer is dropped
  (section 1).
- _In dev a schema edit reaches the server and this page's HMR in either
  order_: the reads of that module are `pending` until both have arrived,
  which is the schema rule in `layered`, not a timer.

**What a reload does to the stores, for the changed modules only:**

- `SchemaStore` replaces their serialized schemas and removes the modules that
  are gone; `HostStore` replaces the instances.
- Previews, validation, search and references are marked stale for those
  modules, and recompute on demand (marks and demand, as `stores.md` says).
- `layered`'s schema rule now matches, so the reads that were `pending`
  ("another schema") resolve, through the same path as any other change.
- The page in the canvas has the old build's code: its frame reloads. The
  Studio around it does not.

**What must not happen:**

- **A registry that does not load must not take the Studio down.** In code
  mode the assistant can break a `.val.ts`, and the Studio is what it fixes it
  from. `reloadCode` evaluates the new registry before it touches anything; if
  it throws, the Studio keeps the old instances, answers `does-not-load` with
  the error, and the modules whose schema moved stay `pending` with that error
  shown and an action to send it to the assistant. This is the guarantee the
  design tab got by running on the site's build, kept without a second tab.
- **A registry must not be adopted against the wrong manifest.** The versions
  `reloadCode` computes from the registry have to equal the manifest's;
  otherwise (a registry from a build newer or older than the manifest the
  Studio holds) it answers `not-the-manifest's` and waits for the next one.
- **Edits must not be lost because the schema moved.** Today a patch that
  cannot be applied is deleted (`stores.md`), which is right when nothing
  could ever apply it. After a schema change it is wrong: an edit to a field
  that was renamed fails, and deleting it deletes the editor's work. Patches
  that fail right after a code reload are held and shown ("These edits do not
  fit the new schema"), with the choice to discard them or to have the
  assistant move them.

### Tests

- `world.changeCode` drives `reloadCode` in the Studio, through the same
  `val-modules-updated` path in dev and through the manifest's entry for a
  build, so both are covered by every code-change scenario.
- Scenarios: a schema change with unsaved edits (they are kept, and the ones
  that no longer fit are held, not deleted); a new build whose `val.modules`
  throws (the Studio keeps running on the old schema and says why); a module
  removed (it disappears from the Studio); a build with other `@valbuild/*`
  versions (the Studio reloads itself once no write is in flight, and comes
  back where it was with every edit); and the three cases the watch handled
  (a lagging pointer, old and new build answering together, HMR and the
  server in either order), none of which may show anything to the editor.
- A new invariant for every scenario: **no dialog about the schema, ever.**
- Budget: a code change that touches one module re-serializes, re-validates,
  re-previews and re-indexes that module and nothing else.

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
