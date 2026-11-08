# Content versions: one model for every reader

Content is read in many places: a page's server (`fetchVal`, loaders, server
components), a page's hooks (`useVal`), the Studio, Val's own API, MCP and the
hosting platform. This page explains the one model all of them read through
today, so that a change to any of them can be checked against it. The plan
that built it, with the history and the reasons for each step, is
[`docs/plans/one-content-model.md`](../docs/plans/one-content-model.md); you
should not need it to understand what is here.

In one paragraph: **a module's content is its base plus an ordered chain of
patches, applied by one engine.** That content has a **version**, three
strings that change exactly when the content does. Val's server keeps the
newest content in a **head**, one per process, and every server-side reader
reads it. The Studio asks its server what each module's version is (the
**manifest**) and reads the modules it does not hold by version. A page reads
through a list of **sources** in a fixed order, and re-reads its server only
when the Studio says the server has the editor's changes.

```
                  the base (bundle / content version / publish)
                         + the chain (patches, in order)
                         = content at a version
                                    │
        ┌───────────────────────────┼─────────────────────────────┐
        ▼                           ▼                             ▼
  Val's server: ValHead      the Studio: ManifestSource      a page: layered sources
  (one per process; the      (GET /manifest, GET /modules,   (overlay, server draft,
  API, the draft readers     its own edits on top with       snapshot, bundle),
  and MCP read it)           withLocalEdits)                 refreshed on `confirmed`
```

## Words

Val's existing words keep their meaning (see [terminology.md](./terminology.md)
for Source, module file and paths). These are the ones the model adds:

| Word                   | What it is                                                                                                                                                                                         |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **base**               | A module's Source before any pending patch: what the build evaluated it to, or what a content version, a proposal's saves or a publish put in its place.                                           |
| **chain**              | The pending patches of the project in order (the order is `/stat`'s and the patch store's). A module's chain is the patches in it whose path is that module.                                       |
| **patch record**       | `{ patchId, patch }` (`PatchRecord` in `@valbuild/shared/internal`): one patch of a chain.                                                                                                         |
| **the engine**         | `applyPatchRecord` (one patch) and `applyChain` (a module's chain): the only code that turns content and a patch into the next content.                                                            |
| **version**            | `ModuleVersion`, `{ schema, base, chain }`: what a module's content IS. Equal versions are equal content, wherever they came from.                                                                 |
| **`seq`**              | `ProjectVersion.seq`: a number that orders answers. Of two answers, the higher `seq` is the newer.                                                                                                 |
| **the head**           | `ValHead`: the content at the newest chain, kept by version, on Val's server. One per process for a project.                                                                                       |
| **the manifest**       | `GET /manifest`: every module's version and the `ProjectVersion`, answered by the server.                                                                                                          |
| **the view** (Studio)  | What a field reads: the server's module at the manifest's version, with this Studio's own edits on top (`stores/studioView.ts`).                                                                   |
| **a source** (readers) | A `ContentSource`: one place a reader's content can come from (the Studio's relay, the server's draft, a snapshot, the bundle). It answers `ready`, `pass` (ask the next one) or `pending` (wait). |

## The one model: base, chain, engine

### The engine

[`packages/shared/src/internal/content/applyChain.ts`](../packages/shared/src/internal/content/applyChain.ts)
holds the engine. It runs in Val's server, in the Studio and in the demo's
in-tab server, so the three apply patches by the same rules.

- **A module's content** is `ModuleContent`, `{ source, entries }`. `source`
  is the Source with `.jsonValues()` entries as markers. `entries` holds only
  the entries the chain has touched, each an `EntryState`:
  - `content`: the entry's content, known;
  - `waiting`: an entry nobody has loaded, with the ops for it held (`HeldOps`,
    a linked list, so N edits cost N), applied when somebody reads the base
    entry (`resolveEntry`);
  - `deleted`: removed, or moved away;
  - `error`: an op on it did not apply. Sticky, as a module's failure is.

  An entry the chain never touched is not in the map and costs nothing: it is
  the base's.

- **`applyPatchRecord(module, record, schema)`** applies one patch. It
  answers `applied` with the next content, or `failed` with the patch id and
  why; half a patch is never applied. The serialized schema is read only to
  find where `.jsonValues()` records are, so the engine knows which ops reach
  into an entry (`classifyJsonValuesOp`) and expands a write of the whole
  record into one op per entry (`expandJsonValuesRootOp`, the same function
  the publish uses).
- **`applyChain`** applies a module's chain and **stops at the first patch
  that does not apply**: the module's later patches, and its entries with
  them, are not applied. `applied` says how many did, so the version names the
  chain the content is AT, not the whole chain.
- **Copy-on-write.** Nothing is mutated. An op copies the containers on its
  path and shares everything else, so a patch costs the depth of its path, not
  the size of the module, and a subtree no op touched keeps its identity:
  "did this path change?" is `===`. A record's root is copied with a plain
  loop rather than a spread, which V8 runs about twice as fast on a large
  object (the comment on the copy says by how much).
- **A file's `patch_id`.** A `file` op carries bytes (a SHA-256 by the time it
  is in a patch), not content. After the patch's other ops, the engine writes
  `patch_id` where the file LANDS: the op's path plus `nestedFilePath` (a
  video's poster and captions are file ops on the video's own path). Inside a
  `.jsonValues()` entry the mark goes in the entry's content. That mark is
  what makes `Internal.mediaUrl` serve the file from the patch store
  (`/api/val/files…?patch_id=`) until it is published; see
  [media.md](./media.md).
- **Counted.** `engineWork()` counts patches applied (`engine:apply-patch`)
  and bytes copied (`engine:clone-bytes`, eight bytes per slot copied). Tests
  budget both.

`/save`'s rewrite of the `.val.ts` and `*.val.json` text is the one thing
that does not go through the engine, by design: it changes text, not
content. Its `moduleVersions` (what each changed module IS after the commit,
which content history records) does go through it.

### Where a chain stops, on each side

The server stops a module's chain at the first patch that does not apply.
The Studio passes over such a patch and applies the rest (`extend` in
`studioView.ts`), because stopping would hold every later edit behind a patch
the Studio is already deleting: a patch that cannot apply is deleted
(`discardUnapplicable`), and once the delete lands both sides apply the same
ids and name the same version. The Studio's version names only what applied,
so it never claims a patch it passed over.

The exception is a patch that applied under a module's previous schema and
does not under the new one. That one is held, not deleted (see "Code
changes" below), and while it is held the server's read of that module stops
at it.

## Versions

### `ModuleVersion` and `ProjectVersion`

[`packages/shared/src/internal/content/version.ts`](../packages/shared/src/internal/content/version.ts):

```ts
type ModuleVersion = {
  schema: string; // sha(ENGINE + serialized schema)
  base: string; //   sha(the base Source)
  chain: string; //  a fold of the module's applied patch ids; "" for none
};
type ProjectVersion = {
  build: string; // the build serving the answer
  seq: number; //   order only
};
```

Each kind of change moves exactly one part:

| What changed                                                      | What moves                           |
| ----------------------------------------------------------------- | ------------------------------------ |
| A module's schema (a field added)                                 | that module's `schema`               |
| `@valbuild/*` upgraded                                            | every `schema` (`ENGINE` is in each) |
| A literal in `c.define(...)` edited, a publish, a content version | that module's `base`                 |
| An edit, a discard, a publish (which empties the chain)           | that module's `chain`                |
| Code that is not content (a component, a route)                   | only `ProjectVersion.build`          |

- **`moduleKey(path, version)`** is `<path>@<schema>.<base>.<chain>`: the
  address of a module's content, which never changes meaning.
  `parseModuleKey` reads one back.
- **A base is a version with the empty chain** (`EMPTY_CHAIN`, `""`). So a
  base needs no concept of its own: it is read and stored like any other
  version.
- **`chain`** is `extendChain(prev, id)` per patch: identity, not order. The
  same patches on the same base and schema are the same version, which is why
  the Studio's optimistic version of its own edit is the version the server
  names once it has the edit.
- **`EntryVersion`** (`moduleStore.ts`) is a `.jsonValues()` entry's own
  version: the record's `schema` and `base`, the entry's `key`, and the chain
  of only the patches that touched THAT entry. An entry no patch touched keeps
  its version while the record's chain grows.
- **`staged:<inputs>`** (`STAGED_SCHEMA_PREFIX`) is the schema version of a
  module that was staged in a proposal after the build serving it: the
  server has the module's new text but not its evaluated schema, so it names
  the staging instead. No reader's code has that schema, so nothing reads
  that content with its own. See "Code mode" below.
- **`ProjectVersion.build`** is the fold of what the modules evaluated to
  (`baseSha`), prefixed by the host's own name for the build when it has one
  (`VAL_BUILD`, `publishBuild`, else the commit).

### `seq`, per mode

`seq` answers "is this answer newer than that one?", which a version cannot:
two builds can both be right about different bases. Every write, delete,
publish and repair moves it, and so does each new build, once.

| Mode   | Where `seq` lives                                                                                                                                                                                                                                                                                                                                  |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| fs     | `.val/patches.seq`, beside the lock and not inside `.val/patches/` (delete-all and reset rename that directory away). Bumped under the lock after the change is on disk; a new build bumps it once (the file records which build last did). See [patch-store.md](./patch-store.md).                                                                |
| memory | A counter per patch store (`seqOf` in `ValOpsMemory.ts`), bumped beside `announceChange`; a new build counts itself once.                                                                                                                                                                                                                          |
| http   | The content service's `headVersion` for the branch, which it bumps with every write, delete and publish, and once when a deployment goes live (`countDeploymentLive` in valbuild/home). Read alone with `GET /v1/{project}/chain/version` (`ValOpsHttp.chainSeq`); 404 from an older service, which makes the head read the whole chain each time. |

A reader takes `seq` BEFORE it reads what it answers with, so an answer is
never behind the `seq` it carries.

In http mode there is a window: a new build answers at the old `seq` until
the content service hears it went live (seconds for the platform's own
builds, a webhook's delay for a GitHub deployment). Only `build` tells those
answers apart.

### Computed when content changes, never when read

Hashing on a read would make every read cost the size of what it reads. So:

- `schema` and `base` are hashed when the modules are evaluated, or when a
  base is adopted (a publish, a content version, a proposal's saves).
- Chains are kept by `ChainFold` (`version.ts`), which is extended by the
  patches the chain gained since the last call and folded again from the start
  only when the chain changed anywhere but at its end (a discard in the
  middle, a publish). `ChainFold.chainAt(path, n)` answers the chain of a
  module's first `n` patches without hashing, which is what names the version
  of content whose chain stopped.
- The Studio hashes when a schema or a base arrives and once per patch it
  applies (`SourceStore.versionOf`).

Every hash is counted (`versionHashCount()`, `version:hash`), and B04 in the
scenarios asserts that a read hashes nothing.

## On the wire

### `GET /manifest`

Every module's version and the project's, answered from the head
(`ValServer.ts`, `"/manifest"`):

```ts
{
  project: ProjectVersion;
  modules: Record<ModuleFilePath, ModuleVersion>;
  tag?: string;           // this answer's ETag, also in the body
  since?: number;         // present on a delta only
  superseded?: true;      // a previous build still answering (http)
  registry?: { entry: string; core: string }; // where this build's code is
}
```

- **The ETag** is the build, the base fold, `seq` and the chain fold's epoch,
  concatenated (`ValOps.manifestTag`): nothing is hashed to answer it. A
  request whose `If-None-Match` is the current tag gets a 304. The tag is in
  the body too because the Studio reads through `ValClient`, which hands over
  bodies, not headers.
- **"Since `seq` N"** (`?since=N` with the held tag as `If-None-Match`)
  answers only the modules whose version moved since the manifest that tag
  names, with `since: N`. The instance keeps the last four manifests it
  answered (`rememberManifest`, `manifestSince`); one it does not hold, one
  for another build, or one whose `seq` does not match is answered whole,
  which is always correct.
- **`superseded`** (http): the content service told this build that a newer
  one is live (`liveBuild`). Its versions are right for its own bases, which
  the site no longer serves; the Studio does not move to them and asks again.
- **`registry`**: the answering build's `val.modules` as an ES module a
  Studio can import, and the `@valbuild/core` it runs. Only a build the
  platform made names one. See "Code changes".

### `GET /modules/~<path>[?v=<moduleKey>][&have=<moduleKey>]`

One module at a version, answered by `ValHead.answer`:

- `v` is the version wanted, as its `moduleKey`; the newest when absent. A
  base is asked for as the version with the empty chain.
- `have` is the version the caller holds. When the newest version is asked
  for and `have` has its schema and base and a start of its chain, the
  answer is a **delta**:
  `{ kind: "delta", from, to, patches }`, the patch records from `have` to
  `v`. Another editor's keystroke is then one patch on the wire, not the
  module.
- Otherwise the whole module (`kind: "module"`): its `version`; `source`,
  with `.jsonValues()` markers without their `import()`; `entries`, the
  entries its chain touched, read, each with its `EntryVersion`; `patches`,
  the ids the version's chain is made of; and `failed` where its chain
  stopped.
- An answer for an asked `v` is `Cache-Control: immutable`: content at a
  version never changes. A version the head does not hold any more is a 404
  with `current`, the version it does hold.

### Other answers that carry versions

`/stat` and `GET /patches` answer `version` (a `ProjectVersion`); `GET /json`
carries the `ModuleVersion` of what it answers. `GET /json`
reads many entries in one request (`?path=<module>&keys=<k1>&keys=<k2>…`, up
to `JSON_ENTRIES_BATCH_MAX`, 100; `apply_patches=false` for the Studio, which
applies its own chain) and answers with the record's version. An entry's own
`EntryVersion` comes with `GET /modules` and the server's draft reads.

## Val's server: one runtime, one head

### The runtime

`valRuntime(valModules, config)`
([`packages/server/src/valRuntime.ts`](../packages/server/src/valRuntime.ts))
returns ONE `{ ops, authorize }` per `valModules` object and data-layer
options in a process (or isolate). The API route (`initValServer`), the draft
readers (`initValContent`, `initValRsc`, through `createValRuntime`) and MCP
(`initValMcp`) all get the same one, so a save or a publish through the API
moves what every reader reads. HMR makes a new `valModules`, so a new
runtime. `authorize(session)` is the API's own rule (`sessionAuth`), plus a
signed-in editor in http mode.

### The head

`ValHead` ([`packages/server/src/head.ts`](../packages/server/src/head.ts)),
`ops.head`, is the content at the newest chain. Draft content is not per
user, so one head serves every editor; the session only decides who may read
it.

- **"Has the chain moved?"** is `ValOps.chainSeq()`: the store's `seq` in fs
  and memory, `GET /chain/version` in http. `head.sync()` fetches the chain
  only when `seq` or the base moved, and a read that finds a fetch under way
  at the `seq` it saw joins it. The chain a draft applies is `draftOverlay`'s:
  the pending patches, and the ones published after this build (which the
  build does not have).
- **The store** ([`packages/shared/src/internal/content/moduleStore.ts`](../packages/shared/src/internal/content/moduleStore.ts))
  holds modules by `moduleKey`. Content at a version never changes, so it
  needs eviction and never invalidation. `tiered(tiers)` asks each tier in
  turn and writes a slower tier's answer to the faster ones. The head's tiers:
  1. `memoryTier`: a byte budget (`HEAD_BUDGET_BYTES`, 16 MB), the least
     recently read let go first, and the last two versions per module
     (`HEAD_VERSIONS_PER_MODULE`).
  2. `bundleTier` of the build: answers a key whose version is the build's
     own (its schema, its base, the empty chain) with the build's own object,
     for nothing.
  3. `bundleTier` of the base the build serves where it is not the bundle's:
     a content version, a proposal's saves, a publish adopted in the process.
- **A module is made when it is read and has patches**, never all at once.
  It is made from the newest version held when that version's chain is a
  start of this one (a keystroke: one apply), else from its base (a discard,
  a publish, an eviction). What a version costs the budget is what it holds
  beyond its base (`heldBeyond`: the containers the engine copied and the
  values the patches brought), not the module's size.
- **Entries** are resolved once per version and key. A record's keys are
  walked once per record object (`recordKeysOf`), so an entry request costs
  the entries it asks for, not the size of the record.
- **No validation and no previews on the read path.** The Studio previews from
  its own schema instances and validates in its worker and through
  `/validate`.

What it answers: `module(path)`; `entries(path, keys)` (`GET /json`, the
single-entry readers); `draft(path)` (what a draft reader gets: `bundle` when
the newest version is the build's own, otherwise the source with the entries
the draft changes filled in); `changed()` (the modules a draft changes:
`fetchValDraft`); `tree()` (every module: MCP's `loadState`);
`answer(path, { v, have })` (`GET /modules`).

All of it is counted (`headWork()`: `head:seq`, `head:chain`,
`head:materialize`, `head:record-scan`, `head:entry-resolve`).

### A previous build still answering

During a hot reload or a rollout, two builds answer one Studio. They are
told apart differently by mode:

- **fs and memory**: the patches belong to the store, relative to what the
  NEWEST build evaluated. So `GET /manifest` and `GET /modules` are answered
  by the head of the newest data layer made in the process for that root or
  patch store (`ValOps.newestOps`), whichever instance the request reached,
  and `/stat` names that build: its base (`ValOps.chainBaseSha`) and, as
  its version's `build`, the build itself (`ValOps.chainBuild`). The long
  poll compares the `version` a Studio echoes with that build to see a new
  one, so every instance on one store answers it alike and a Studio parked
  on the old instance is told of the new build once, not on every poll.
  "Newest" is by when the instance was made, not when it first answered;
  and `seq` does not order builds, because the old instance reads the same
  counter.
- **http**: the content service answers each build with the patches that
  build does not contain, so a build's own base is right for its chain. Only
  the service knows a newer build is live: every `applicable/patches` call
  reports the caller's base (`sources_sha`), `/stat` asks for the chain
  relative to the live build (`relative_to=live`), and a previous build's
  manifest says `superseded`.

## The readers

### Sources and `layered`

Every reader of both frameworks -- `fetchVal`, `fetchValKey`,
`fetchValRoute`, `fetchValRouteUrl`, `fetchValDraft`, `useVal`, `useValKey`,
`useValRoute`, `useValRouteUrl` -- resolves through the same pipeline, in
[`packages/react/src/read/`](../packages/react/src/read/) (exported from
`@valbuild/react/internal`: what the framework packages share, not API).
They differ only in their list of sources and in how they wait.

- **`ContentSource`** (types in
  [`packages/shared/src/internal/content/source.ts`](../packages/shared/src/internal/content/source.ts),
  because the server's source is written in `@valbuild/server`, which cannot
  import React's package) answers a module with a `ModuleRead`: `ready` (a
  Source, who answered, and its version where it has one), `pass` (no say:
  ask the next source) or `pending` (will have a say: wait). An entry has one
  more answer, `gone`: "this entry is not there", which is not the same as
  `pass`.
- **`layered(sources, rule, settled)`** is the one place that decides which
  source wins: the first that does not pass. It is also the only place the
  **schema rule** is applied: a `ready` answer whose `version.schema` is not
  the schema the reader's own code has (`schemaOf`) is not read. With
  `codeChanged` the read waits for the code; without it, the next source
  answers, which ends at the reader's own bundle. A wait in `settled` (it is
  over, and the source still answered `pending`) is passed over, so a read
  never loops on a gate that resolved without an answer.
- **`planOf(selector)`** says which modules a read needs and which module
  objects it carries; **`resolveVal`** reads them, fills a whole
  `.jsonValues()` record's entries, and once nothing is pending
  `stegaEncode`s the value, returning it with the reads it was made of
  (`ReadOf`: path, source, version). `resolveValEntry` and
  `resolveModuleEntry` are the single-entry plans through the same function.
- **`ReadEnv.encode`** (edit tags) is decided once per request or render,
  from draft mode, so no error path can drop it.
- **How they wait:** `awaitResolved` on the server (wait, resolve again);
  `useResolved` in a component (`useSyncExternalStore` on the sources'
  `revision`, then `React.use` on what is pending).

### The source order

| Reader                               | Sources, first that does not pass wins                  |
| ------------------------------------ | ------------------------------------------------------- |
| Server, draft mode (both frameworks) | `serverDraftSource`, `snapshotSource`\*, `bundleSource` |
| Server, a visitor                    | `snapshotSource`\*, `bundleSource`                      |
| A page's hooks, TanStack             | `overlaySource`, `snapshotSource`, `bundleSource`       |
| A page's hooks, Next.js              | `overlaySource`, `bundleSource`                         |

\* TanStack only: Next.js has no snapshot (`initValContent.ts`,
`initValRsc.ts`; `pageReadEnv` in each framework's `initValClient.ts`).

- **`serverDraftSource`** (`packages/server/src/draftReads.ts`) reads
  `head.draft(path)` and `head.entries`, one wait each. A module whose newest
  version is the build's own PASSES, so the reader's bundle answers it and
  nothing is read for it: a draft read of an unedited module costs one "has
  the chain moved?" and no module (B12). Every error is a `pass`, logged: a draft that cannot be read
  is the published content. `draftForRequest` decides draft mode and the
  session from the request; a visitor pays one cookie lookup.
- **`snapshotSource`**: the platform's content version and a proposal's saves
  (`ValDraft.snapshot` in the browser), for the modules it has.
- **`overlaySource`**: what the Studio relayed to the page
  (`ValExternalStore`). Its states are the three waits `suspend` is made of
  (see [quirks.md](./quirks.md), "`suspend` is three waits"): without
  `suspend` every wait is a `pass`, so nothing suspends that did not before.
- **`bundleSource`**: the reader's own build. It passes on every module (the
  selector carries its Source already) and answers entries with its own
  `import()`s, started when an entry is first read and kept by MODULE OBJECT,
  so a new build or a hot reload is a new key, never an old answer.

The schema rule is applied by the server readers (`schemaVersionOf:
readerSchemaVersion`, hashed once per module object). The page's hooks set
none: their code is their build, and what the Studio relays is compared by
version only to see whether it moved.

### Laziness

Three things stay lazy:

- **A `.jsonValues()` entry is imported when it is read**, never before. A
  route reader on a `.jsonValues()` router imports the route's entry and no
  other; `useValRouteUrl` and `fetchValRouteUrl` import none.
- **A view (`s.view`) is resolved when someone reads it**: the encoder does
  not ask the store for the target, `getModuleIds` of the page names the page
  alone, and no entry thunk of a viewed module fires
  (`stegaEncode.test.ts`, "reading a view is lazy").
- **The server reads a module only when its newest version is not the
  bundle's.**

### The `draft` prop

`fetchValDraft()` (returned by TanStack's `initValContent` and Next's
`initValRsc`; both are `readDraftChanges` in `draftReads.ts`) returns a
`ValDraft` ([`packages/react/src/read/draft.ts`](../packages/react/src/read/draft.ts))
for `<ValProvider draft>`, or `null` after one cookie lookup when draft mode
is off:

- `sources`: the modules the draft changes (`head.changed()`), with the
  entries it changes in place of their markers.
- `versions`: the version of each of them. The page compares what the Studio
  relays with what it was rendered with by version.
- `snapshot` (TanStack): a proposal's saved Source, sent whether or not draft
  mode is on.

`createDraftStore(draft)` seeds the page's overlay store with it on the server
and in the browser, so the server render and hydration read the same
content, and a route that exists only in a pending patch is found at SSR.

## How a draft page settles

A loader or a server component only shows an edit once the server has it. So
the page re-reads its server when the **Studio says the server has
confirmed** the editor's changes -- never when an edit is typed, and never on
a timer.

```
 Studio (relay)                                 page
 ─────────────                                  ────
                                       ◄──────  draftMode event / canvas `ready`:
                                                holds, holdsVersions
 store in step (onceInStep)
 catch-up: pending + held modules
   source-update {read, source} ──────────────► ValExternalStore.receive
 sources-synced ──────────────────────────────► overlay gate 2 opens
 confirmed {seq} ─────────────────────────────► refresh loop: first is the
                                                connection, not news
 ... an edit, a save, another editor ...
   source-update ─────────────────────────────► hooks re-render (no refresh)
 confirmed {seq'} (seq moved) ────────────────► one refresh (router.invalidate /
                                                router.refresh)
```

The relay is plain functions over the Studio's system
([`packages/ui/spa/stores/react/sourceRelay.ts`](../packages/ui/spa/stores/react/sourceRelay.ts)),
run by the overlay (`startOverlayRelay`), the canvas (`useValCatchUp`) and
the scenario world alike.

- **The page reports what it holds** when it connects: the modules it was
  rendered with a draft of (`draftHolds`) and their versions
  (`draftHoldsVersions`), on the overlay's `draftMode` event and the canvas's
  `ready` message.
- **The Studio waits until its store is in step** (`onceInStep`): the first
  manifest adopted and the chain's records fetched and applied
  (`PatchStore.chainSettled`). A server that answers none of that is given
  five seconds (`IN_STEP_FALLBACK_MS`), a fallback, not how the page
  converges.
- **The catch-up** (`startCatchUp`, `sendPendingSources`) sends every module
  with pending patches and every module the page holds, except one the page
  holds at the Studio's version. A module whose touched or publish-marked
  `.jsonValues()` entries the Studio has not read is held back until they are
  (`SourceStore.entriesToRelay`), so the page never fills them from an older
  bundle. Then `sources-synced`: after it, a module the page was not sent has
  no draft.
- **`source-update`** carries `read`, a `ModuleRead` with the Studio's
  version, which the page keeps as it is. Changes are collected for 200 ms
  before they are sent (`DEBOUNCE_MS`). `ValExternalStore.receive` compares
  with what it holds by version when both have one, and by content when one
  has none, and answers whether the value moved.
- **`confirmed { seq }`**: the server's `seq` the Studio adopted
  (`subscribeConfirmed`: an adopted `/stat`, and in http a save's own answer,
  which names the chain version it made). Sent once after the catch-up, then
  each time it moves forward.
- **The refresh loop** (`startRefreshLoop` in
  [`packages/react/src/read/refreshLoop.ts`](../packages/react/src/read/refreshLoop.ts),
  both providers): one refresh per confirmed `seq`; a `seq` told twice or late
  is one; at most one in flight where the refresh says when it is done
  (TanStack's `router.invalidate()` promise), each time where it cannot
  (Next's `router.refresh()`). The first `confirmed` refreshes only if the
  catch-up moved what the page holds. Turning draft mode on or off refreshes
  at once. The loop has no timer.

A page that suspends on `sources-synced` gives up after ten seconds
(`LOAD_TIMEOUT_MS` in `overlayStore.ts`); with the `draft` prop the store is
full before the first render and nothing waits.

## The Studio

What a field shows is the module at the version the server's manifest names,
with this Studio's own edits that the server does not have yet on top.
[stores.md](./stores.md) has the Studio's rules about fields (`peek`, `get`,
waking per path); this is how the content under them is loaded.

### `ManifestSource`

[`packages/ui/spa/stores/manifestSource.ts`](../packages/ui/spa/stores/manifestSource.ts):
after each `/stat` the stores adopt whose `seq` moved, it reads
`GET /manifest` "since `seq` N" with the held tag (a 304 while nothing
moved), shows the manifest to `BuildCode` first (see "Code changes"), reads
each module at the version named, and moves the source store to all of them
in ONE turn (`SourceStore.adoptServer`). One read at a time; a stat during
one reads again after it. A read that fails decides nothing, and the next
stat asks again.

The patch store takes the stat's list at once, as before (the head a save
names, the records the review lists); the content follows the manifest.

### Where a module at a version comes from

`ManifestSource.resolve` asks, in order:

1. **What the store is at already**, when the base and the version match.
2. **What this Studio computed itself**: its own edit, now confirmed. The
   version the server names for it is the one the Studio computed (same
   schema, base and patches), so it is found in the `VersionRing` by its
   content, or, when the editor typed on past it, by its patches alone
   (`SourceStore.knownChain`, the last 64 chains computed per module). A
   `GET /modules` for your own edit is a bug.
3. **The bundle**: a version with the empty chain on the bundle's base needs
   nothing read.
4. **`originTier`** ([`originTier.ts`](../packages/ui/spa/stores/originTier.ts)):
   `GET /modules/~<path>?v=`, with the server's version held of the same
   schema and base as `have`, so another editor's keystroke is one patch. A
   base the bundle was not built with (a content version, a publish, a
   proposal's saves) is read by its version (the empty chain), then the
   patches from it.

These are the store's tiers, but not the shared `tiered`: the Studio's memory
holds `ModuleAt`s (content plus what applied and what failed), and the order
is written out in `resolve`.

### `withLocalEdits` and the view

[`packages/ui/spa/stores/studioView.ts`](../packages/ui/spa/stores/studioView.ts):

- **`withLocalEdits`** applies, on top of the server's module, the module's
  patches the server's version does not have, in chain order. They are this
  Studio's own: another editor's patch is shown once the server's version
  has it, and never replayed here, though its record still arrives
  (`GET /patches`, for the review, the head and the publish). Where nothing
  has been decided yet -- before the first manifest, after a re-intake moved
  the base, on a module new code put this Studio ahead on, a system with no
  server -- every patch of the chain is on top.
- **`VersionRing`** keeps the last two versions per module (`KEPT = 2`), by
  the ids they were computed for. A keystroke extends the newest by its one
  patch (one engine apply, its path copied, whatever the module's size), and
  a discard of the newest patch is the version before it, applied again by
  nothing.
- **The engine reads only where `.jsonValues()` records are in a schema**
  (`engineSchemaKey`), so a code change that does not move them changes a
  module's version and not one object of its content: nothing repaints and
  nothing is relayed.
- **`SourceStore`** sits on top. It makes each module's view in ONE place
  (`refresh`), keeps `peek` reference-stable by key, wakes readers by `===`
  after a recompute, and computes versions (`versionOf`) when content changes.
- **A publish** (`promotePublished`) bakes the published patches into the base
  WITHOUT their `file` ops: the files are where their paths say now, and a
  `patch_id` left in the base would point a URL at a patch that is gone.

### Vanished patches

`/stat` is the authority on order, not on existence: an answer can be older
than a patch it does not name. A patch a `/stat` stopped naming is gone when
the server's version of its module does not have it AND the manifest naming
that version was asked for after this Studio held the patch (its record
arrived, or its save was confirmed): `PatchStore.decidedGone`, ordered by
`nextManifestEpoch`, a counter of the tab's own. It is settled at the stat and
again when its manifest lands (`PatchStore.manifestAdopted`). A moved base
says it was published rather than discarded.

### Entries

`.jsonValues()` entries load in batches: the reads of one tick go out as one
`GET /json` with `keys` (25 a request, within the URL budget), and
`loadAllEntries` (search, "used by", a rename guard) sends batches of up to
100 keys, at most three in flight, applying what landed after
`yieldToMain` as one batch (`receiveJsonEntries`): one view, one revision, one
wake. See [stores.md](./stores.md).

## Code changes

### One door: `reloadCode`

`HostStore.reloadCode(registry, { expected })`
([`packages/ui/spa/stores/HostStore.ts`](../packages/ui/spa/stores/HostStore.ts))
is how any `val.modules` registry reaches the Studio: the first one, HMR
(`val-modules-updated`), code the tab evaluated after a staging, and a new
build's own registry. It reads the registry before it touches anything and
answers:

- `reloaded`, with the modules whose schema moved and the ones that went (a
  module no longer in the registry is removed: an intake replaces, it never
  merges);
- `kept`, with `does-not-load` (the registry, or its import, failed: the
  Studio stays on the code it had), `other-val-version` (a build running
  another `@valbuild/core`, which is not imported at all) or
  `not-the-manifest's` (a build's registry whose schema versions are not the
  ones the manifest that named it says; `staged:` modules aside).

Only the modules that moved are touched downstream: an imported bundle is
compared by content (serialized schema and written Source), HMR by instance.
Validation, previews, search and references are marked stale for them
(`schema:init`).

### A new build while the Studio is open: `BuildCode`

[`packages/ui/spa/stores/buildCode.ts`](../packages/ui/spa/stores/buildCode.ts)
sees every manifest before it is adopted. Where the manifest names a schema
the Studio does not run, for a module it is not ahead on, the code moves
first, so content is never read into the old fields:

- **A build the platform made** names its registry: `@valbuild/tanstack-build`
  emits the project's `val.modules` as `/_app/val-modules-<build>.js` beside
  the client chunks (`valModulesEntry`), and the server that knows the build's
  name (`VAL_BUILD`) puts it on the manifest (`ValOps.buildRegistry`). The
  Studio imports it and hands it to `reloadCode` with the manifest, once per
  build. It is a public file, like every client chunk, and it holds what
  `val.modules` evaluates to: the PUBLISHED content of every module in the
  build, including modules no page renders and `.jsonValues()` entries no
  page links to (behind their `import()`s, which are public chunks too).
  Accepted: nothing in it is a draft, and its name is the build's, which is
  not listed anywhere a visitor reads. Content that must not be public must
  not be published content in `val.modules`.
- **Local development (fs)**: HMR brings the code; nothing happens here.
- **Anything else** (Next.js, a self-hosted TanStack Start, another Val, a
  registry that does not load): the page reloads itself, without asking, once
  the schemas have stayed apart for `STUDIO_RELOAD_GRACE_MS` (3 s) and nothing
  is being saved -- and only if this Studio's code and the server's have
  agreed once, so a page loaded on a build the server does not run never
  reloads into itself.

There is no schema dialog. A previous build still answering never reaches
`BuildCode` (it is `superseded`), and manifests are read one at a time in
`seq` order.

### When the Studio is ahead of its server

New code can reach the Studio before the server: HMR in either order, or
staged code the tab evaluated. For a module whose schema new code moved
(`schema:init` after the first intake) and that no build has answered with
yet, the manifest's version is not moved to (`ManifestSource.ahead`): the
server's version was made with the old schema and has no field the new code
added. The module keeps the base the Studio's own code wrote, with every
patch of its chain on top, until the manifest names the Studio's schema.
Where the SERVER is ahead (a deploy, a proposal built without the tab
evaluating it), its version is taken.

### Held edits

A patch that applied under its module's previous schema
(`SchemaStore.version`, recorded per patch when it applies: `fittedUnder` in
`createSystem`) and does not under the new one -- a field renamed or removed
under a pending edit -- is **held**, not deleted: `StatusStore.held`, shown in
`HeldEditsBanner` with Discard, and a publish is refused while it is held
(`held-edits`). One that applies again (the code moved back) is released. A
patch that never fitted is deleted as before, and so is one a Studio never
saw fit (opened after the change): a patch carries no schema version on the
wire.

### Staged code, evaluated in the tab

In a proposal, the assistant's `write_files` stages code. Where the page can
run the builder (`canBuildHere`: a cross-origin isolated page), it starts
`runStagedCode` (`packages/ui/spa/proposals/stagedCode.ts`): bundle
`val.modules` with the proposal's files over the site's (`bundleValModules`),
evaluate it in a worker (`evaluateTree`), import the same bundle in the
Studio's realm, and `reloadCode`. `write_files` answers `valModules`
(`schemaChanged`, `removed`, `contentErrors`), or why the code does not run;
an evaluation that finishes after the answer is told on the assistant's next
tool answer (`untoldStagedCode`). Where the builder cannot run, nothing is
evaluated, and the schema arrives with a build.

### The build carries its inputs

At a proposal's address the platform serves a new overlay (`VAL_OVERLAY`)
after every staging, on the build it already runs, so the server there can
hold staged text its build never evaluated. The overlay's `staged` names each
staged module file with `staged:<inputs>`, and `VAL_BUILD_INPUTS` names the
staging the serving build was made of (`ValProposal.staged`,
`.buildInputs`). `stagedAfterBuild` compares them:

- a staged module whose version names the build's inputs is the build's;
- any other is **staged after the build**: its Source is read from its staged
  text without running it (`stagedModuleSources`), its version is
  `staged:<inputs>` on every answer, a save applies to that text with no
  schema, and the page's readers leave its saved Source out
  (`proposalAsBuilt`), so content made for code they do not have is never read
  with theirs;
- one whose Source cannot be read from its text (made by code, or a
  `.jsonValues()` record) is **held**: a save that touches it is refused with
  the reason ("build the proposal, then save"), and the edit stays pending.

## Code mode on proposals

In a proposal in code mode, content and code are never in two places when
code changes. Val's half:

- **Code mode is the proposal's**, kept by the content service; whether a
  person sees the code workspace is their own. Turning it off discards
  nothing; the code tools then refuse, naming who turned it off, and the
  assistant can ask with `request_code_mode`.
- **Every pending change is saved before code mode is turned on and before
  each code write** (`beforeProposalCodeWrite` in `ValServer.ts`, which sees
  `code-mode`, `files` and `take-push` at the proposal's own address), in the
  server's write path, so every writer gets it. A code write with code mode
  off is refused.
- **Saves and stagings do not push to git.** Save is the button; its caret
  opens Commit (connected projects: one commit on `val/p/<name>`) and Publish
  (what is not on the branch yet, committed and merged as one step), with
  the project's `studio.commitMessage`.
- **Somebody else pushed to `val/p/<name>`**: Commit and Publish are refused,
  naming who and linking their commit (`CommitRefusedNotice`), and offer
  **Build on their push** (`buildOnTheirPush`, content's
  `POST /proposals/:name/take-push`): their files come in, the proposal's
  version is kept where both changed a file, and their commit becomes the next
  Commit's parent. The preview is rebuilt, and Publish waits for it.

The other half -- the push job, the commits, the take-push contract and the
merge -- is valbuild/home's: see its `docs/proposals.md` and
`docs/design-tab.md`.

## What the 128 MB measurements found

A hosted site runs in a Cloudflare isolate of 128 MB, shared with the app's
own code. The method, and why local `workerd` proves nothing about the limit,
is [`scenarios/measure/README.md`](../scenarios/measure/README.md); the
numbers are in [`scenarios/measure/results.md`](../scenarios/measure/results.md),
"The deployed isolate".

- **Before the head**, a draft-mode page asked the whole tree, previewed and
  validated, on every request. Deployed on a plain Worker, that read was
  killed at about 75 MB of synthetic content on its own and 59 MB beside
  64 MB of ballast, and the isolate did not outlive it (was replaced after
  the request) from 16 to 43 MB.
- **After the head** (deployed, same Worker): a draft page's read (`reader`,
  every module through `serverDraftSource`) was never killed in its own
  right. It answered wherever the content loaded at all: 86 MB beside 64 MB
  of ballast, `.jsonValues()` routers of 100,000 entries with 650 patches,
  and valbuild/web. The head held at most 56 KB, 0.3% of its 16 MB budget: the
  head charges the paths a patch copied, not the module.
- **So the ceiling is the content the bundle holds**, as it is for starting
  the server at all, and the head's budget is not the number that decides
  it. The whole-tree `PUT /sources/~` was killed where it was, less
  validation; nothing on a page's path asked it any more, and it was removed
  in the release after the one content model.
- **Not measured yet:** the same through valbuild/home's loader
  (`worker_loaders`), which is how a site's isolate is actually started.

In Node, a draft read of every module went from 39 ms (valbuild/web) and
504 ms (21 MB) on every request to 0.4 and 0.08 ms once the head has it, and
the heap it retains from about 1.8 times the content to what was edited.

## How it is tested

The approach: **tests replace the network, the clock and nothing else of
Val's** (`.agent/rules.md`, test rule 3). See
[`scenarios/README.md`](../scenarios/README.md).

- **Scenarios** (`scenarios/`): Val's real server in memory, fs and http mode
  (http against `e2e/mock-content-host` in the test's process, with its
  socket), Studios with the real `/stat` loop on one fake clock, a page's
  server and client halves, the relay, the refresh loop, uploads, two builds
  answering at once, code changes, proposals and code mode. Every scenario runs
  in every mode it can (`describe.each`).
- **Invariants**, checked for every scenario (`world.expectInvariants()`,
  `scenarios/src/world/frames.ts`): every surface converges on the server's
  version; never goes back unless the chain did; the same version shows the
  same value on every surface; nothing is read with another schema; and no
  Studio is reloaded by a schema change unless the scenario says so
  (`Studio.reloads`).
- **Budgets of counted work** (`budgets.scenario.test.ts`, B01-B14), never
  milliseconds: a keystroke applies once and copies its path; another editor's
  keystroke costs one patch; reading hashes nothing; a draft page refreshes
  once per confirmed edit; a Studio keeps two versions; a manifest names only
  what moved; the head holds what was edited; a request asks the head once
  per read; the module endpoint answers a keystroke with the keystroke; an
  entry request costs the entries it asks for.
- **The content-shape matrix** (`matrix.*.scenario.test.ts`): `.jsonValues()`,
  image, file and video libraries and plain media, against every operation
  and every reader, in memory, fs and http (a media publish in fs only:
  memory mode refuses to publish a local file). A cell that is wrong today is
  `test.failing` with its reason; none is.
- **Scale** (`scale.scenario.test.ts`, `scenarios/measure/scale.ts`,
  `e2e/tanstack/scale.spec.ts`): the Studio's surfaces with 1,000 to 100,000
  entries, counted in CI, timed and measured in the browser on a quiet
  machine, printed rather than asserted.
- **Unit and contract tests** for the pieces: the engine's conformance cases
  (`engineConformance.test.ts`, against the old engine kept test-only),
  `version.test.ts`, `moduleStore.test.ts`, `head.test.ts`,
  `manifestRoute.test.ts`, `manifestSource.test.ts`, `buildCode.test.ts`,
  `resolveVal.test.ts`, `refreshLoop.test.ts`, `overlayStore.test.ts`, and
  `homeWireContract.test.ts` for the wire to valbuild/home.

## Where to look

| You want                                    | Look at                                                                           |
| ------------------------------------------- | --------------------------------------------------------------------------------- |
| versions, `seq`, `ChainFold`                | `packages/shared/src/internal/content/version.ts`                                 |
| the engine                                  | `packages/shared/src/internal/content/applyChain.ts`                              |
| the store, tiers, `EntryVersion`            | `packages/shared/src/internal/content/moduleStore.ts`                             |
| the head                                    | `packages/server/src/head.ts`                                                     |
| the runtime                                 | `packages/server/src/valRuntime.ts`                                               |
| the server's draft source, `fetchValDraft`  | `packages/server/src/draftReads.ts`                                               |
| `/manifest`, `/modules/~`, `/stat`          | `packages/server/src/ValServer.ts`, `packages/shared/src/internal/ApiRoutes.ts`   |
| `seq` per mode                              | `ValOps.chainSeq` / `ownSeq` in `ValOpsFS.ts`, `ValOpsMemory.ts`, `ValOpsHttp.ts` |
| `layered`, `resolveVal`, the page's sources | `packages/react/src/read/`                                                        |
| the relay, `confirmed`                      | `packages/ui/spa/stores/react/sourceRelay.ts`                                     |
| the Studio's manifest and origin            | `packages/ui/spa/stores/manifestSource.ts`, `originTier.ts`                       |
| the Studio's view                           | `packages/ui/spa/stores/studioView.ts`, `SourceStore.ts`                          |
| new code                                    | `packages/ui/spa/stores/HostStore.ts`, `buildCode.ts`                             |
| staged code, the build's inputs             | `packages/ui/spa/proposals/stagedCode.ts`, `packages/server/src/proposal.ts`      |
