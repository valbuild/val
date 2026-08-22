# Event-driven stores — architecture

> **Status: experiment.** This is a prototype living alongside `ValSyncEngine`,
> not a replacement for it. Nothing in the app imports it yet. `system.test.ts`
> is the only consumer.

## The idea

A set of small stores, each owning exactly one thing, communicating by **native
JS events**. A store never reads another store's state to decide what to do; it
reacts to an event and, if it needs a fact, asks for that one fact.

A reader (a React hook, or a web component) does two things:

1. Subscribe to events for the one path it cares about.
2. On an event, **pull** the value from the store the event came from.

The event is a notification, never a payload. That is what keeps an edit's cost
proportional to the edited field instead of to the project.

## The graph

```
                    ┌──────────────────────────────────────────────┐
   /stat  ────────► │ stat                                         │
                    └───────────────────┬──────────────────────────┘
                                        │ stat:receive  (patch IDS only)
                                        ▼
   GET /patches ◄────────────── ┌───────────────┐
        (fetch ops)             │ patch         │ ◄── createPatch()
                                └───┬───────┬───┘
             patch:receive ─────────┘       └───── patch:create
             patch:create                          │
                    │                              ▼
                    │                     ┌──────────────┐
                    ├────────────────────►│ patch set    │──► patch-set:update
                    │                     └──────────────┘
                    ▼
              ┌──────────┐   source:patch-apply    ┌───────────────┐
              │ source   │────────────────────────►│ validation    │──► validation:invalidate
              │          │            │            └───────────────┘    validation:result
              │          │            │            ┌───────────────┐
              │          │            └───────────►│ search        │──► search:invalidate
              └────┬─────┘                         └───────────────┘    search:build-index
                   │  ▲                                  ▲   ▲
                   │  └── source:patch-apply ────────────┐│   │
                   │      (back to patch, for the head)  ││   │
                   ▼                                     ││   │
        per-path field events                 ┌────────┐ ││   │
        (external-patch / internal-patch)     │ schema │◄┘┴───┘
                   │                          └────────┘  reads: schema + source
                   ▼
            hooks / web components
```

Every arrow between stores is a `CustomEvent` on the emitting store's own
`EventTarget`. The only non-event edges are plain synchronous **reads** —
`schemaStore.get`, `schemaStore.all`, `sourceStore.moduleSource`,
`patchStore.currentHead`, `patchStore.recordsFor` — never mutations.

## Threading: native events do not cross a worker boundary

`EventTarget` dispatch is **per-realm**. An event dispatched in one thread is
not observable in another; the only cross-thread transport is `postMessage`,
which structured-clones everything it carries.

So "the stores are workers" resolves as: **all stores share one realm, and that
realm is what moves.**

```
                       realm boundary
   ┌───────────────────────────────────────────────────────┐
   │  stat ─ev─► patch ─ev─► source ─ev─► validation       │
   │                │  ▲        │                          │
   │                └──ev───────┴─ev─► search, patch set   │
   └───────────────────────── port ────────────────────────┘
                               ▲
                     main thread: hooks, fields
```

- **Inside**: native events, zero copies, synchronous ordering guarantees.
- **At the edge**: one async boundary. Everything a field calls
  (`sourceStore.get`, `patchStore.getHead`, `patchStore.createPatch`,
  `searchStore.search`, `validationStore.validate`) is `async` **from day one**,
  even though it currently resolves immediately. That is the whole reason the
  set can be lifted into a worker later without touching a single field.

**One worker for the whole set, not one per store.** A worker per store would
replace every arrow in the graph above with a structured clone, and modules run
to 129 KB — patch data would be copied on the stat→patch hop, source on the
patch→source hop, and again on every read. It also makes ordering
unguaranteeable, which breaks the invariant below. The current code runs the set
in one realm and is written so that realm can be a worker; nothing in these
files touches `window`, `document` or React.

**What can never cross:** `Schema` _instances_. They hold the user's `select`
and custom `validate` closures, and closures cannot be structured-cloned.
`createSystem.receiveModules` is the serialization boundary — it takes real
`ValModule`s and hands the stores only `SerializedSchema` plus JSON source. Past
that call, everything the stores hold is clone-safe.

## The invariants

### 1. If an event went out, the source behind it is already applied

The source store owns _both_ patch application _and_ the listener registry.
Because the same function does both, in that order, a field woken by an event
can read immediately and cannot get a pre-patch value. This is structural, not a
convention someone has to remember.

### 2. A read quotes the head it believes is current

`sourceStore.get(path, head)` compares the quoted head against the current one.
If they differ the answer is not a value — it is
`{ status: "resolved-out-of-date", head }`. A slow reply can therefore never
overwrite a newer value, which is what makes an **async** read path safe.

The head is **one global linear head**, mirroring the server's single patch
chain (`parentRef: { type: "patch", patchId }`). The cost is that a patch in
module A makes a module-B reader's head stale, so it re-asks once and gets its
unchanged value back — a wasted read, never wrong data.

### 3. `absent` is a different answer from `module-loading`

`absent` means _the module is loaded, its schema is loaded, and the path is not
there_. It is returned only when the store knows enough to say so; otherwise the
answer is `module-loading`, which says nothing about the path. Collapsing these
two is a long-standing bug source in the current engine, where
`source-not-found` means both.

### 4. Only registered paths are woken

The source store keeps a registry of watched paths, one `EventTarget` per
registered path, and intersects a patch's touched paths against it. A field
whose path was not touched is **never invoked** — not "invoked and returns
early". That is what makes "this field got no messages" a guarantee rather than
an accident of a callback's own filtering.

Path matching is boundary-safe (`pathMatch.ts`): a raw `startsWith` would make
`?p="ab"` a child of `?p="a"`. Matching runs in **both** directions — a patch on
an ancestor changes my value underneath me; a patch under me changes the subtree
I render.

## Why each store exists

| Store        | Owns                                                   | Why it is not folded into a neighbour                                                                                                                                                        |
| ------------ | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stat`       | what the server says exists (patch **ids**, no ops)    | It is the only store with an outside input. Keeping ops out of it is what makes `external-partial` a real state rather than a fiction.                                                       |
| `patch`      | the linear chain, origins, which ids have data         | Knows a patch _exists_; the source store knows whether it _landed_. The head is where those two facts meet, so neither store can compute it alone.                                           |
| `schema`     | serialized schemas                                     | Schemas have their own change sources (`/schema`, HMR swapping a schema under existing source) and their own consumers (validation, search). Today they merely happen to arrive with source. |
| `source`     | patched source **and** the listener registry           | Invariant 1 requires them together.                                                                                                                                                          |
| `patch set`  | patches grouped into reviewable/publishable units      | Answers _"what are the units of change?"_ — coalesced across many patches, and only when the review UI is open. The source store answers _"who do I wake?"_ — exact, now, per keystroke.     |
| `validation` | validation errors, and which modules' errors are stale | Lazy by construction; see below.                                                                                                                                                             |
| `search`     | the full-text index                                    | The most expensive walk in the system, so it must never be a side effect of an edit.                                                                                                         |

### Lazy is the point, for validation and search

Both stores react to `source:patch-apply` by marking modules **stale** and
saying so — `validation:invalidate` / `search:invalidate` — and computing
nothing. Work happens when someone asks (`validate()`, `buildIndex()`).

Typing 40 characters into one field costs 40 set-inserts and **zero**
validations, against one validation round-trip _per keystroke_ today. The search
store additionally only emits `search:invalidate` when the stale set actually
grows, so 39 of those 40 keystrokes emit nothing at all.

Both stores also report **partiality** rather than hiding it: a search result
carries `staleModules`, and `search:build-index` reports `new` and `all`
separately, because `.jsonValues()` entries whose content has not loaded are
skipped by the index walk. A partial index is the normal case, and returning
results without saying so is how "search silently can't find things" happens.

### Validation needs no worker of its own

`ValidationWorkerClient` exists today because the main thread cannot afford to
validate. Here the store set is already off the main thread, and the schema and
source it needs are in the same realm — so validating in place is both off-main
and copy-free. A dedicated worker would add a full module clone per validation
to buy nothing.

It still cannot run **custom** validators: the store holds a deserialized
schema, which has no user functions in it. So `validation:result` reports
`customValidatePaths` — _where_ they must run — for whoever holds the real
`Schema` instances to execute. Same split as today.

## Testing

`testSystem.ts` provides `initTestSystem()`: the real graph, plus

- a **ledger** recording every event from every store's bus, with
  `has(matcher, { since })` that waits and, on timeout, dumps the whole log —
  a system wired out of events fails by _not_ emitting, and "timed out" alone
  tells you nothing about which hop dropped it;
- **listeners** — `set(path)` registers a real field listener and gives you
  `didReceive(...)` and `noMessages({ since })`;
- a fake patch server behind the real `fetchPatches` seam, deliberately async so
  no store can come to depend on the fetch resolving synchronously.

`noMessages()` waits for the pipeline to quiesce _before_ asserting. Asserting
immediately would pass for a system that had not started yet — the most
dangerous kind of green test.

## Known gaps

These are real, and named so they are not mistaken for finished work.

- **No rebase.** HMR and `PUT /sources/~` swap a module's base source under
  existing patches. That needs "replace base for M, re-apply M's chain, bump M".
  The source store deliberately does not keep a base source, because holding one
  that nothing reads would read as though rebase worked.
- **No per-module patch-set reset.** `PatchSets` has no per-module removal, so
  `PatchSetStore.reset(modules)` throws rather than quietly resetting everything.
- **Search rebuilds whole.** Incremental update needs a per-module document-id
  list this prototype does not keep.
- **`stat` has no real input.** No polling, no websocket, and it ignores
  `baseSha`/`schemaSha`/`sourcesSha`. Those are inputs to `schemaStore.receive`,
  not new events.
- **No local patch write-back.** `createPatch` never issues `PUT /patches`, so
  nothing exercises optimistic state, retry, or `patch-head-conflict`.
- **Nothing renders.** No hooks, no `computeRender`. Renders execute user
  closures, so making them lazy and path-scoped is the precondition for the
  worker move — the largest unanswered question here.
- **Unmeasured.** Every performance claim above is read off the code. Nothing
  has been profiled in a browser.
