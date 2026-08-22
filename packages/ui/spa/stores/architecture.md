# Event-driven stores — architecture

> **Status: experiment.** This is a prototype living alongside `ValSyncEngine`,
> not a replacement for it. Nothing in the app imports it yet. `system.test.ts`
> is the only consumer.
>
> **Read [`openquestions.md`](./openquestions.md) first.** It holds the decisions
> and measurements that are still missing, including the go/no-go: nothing here
> has been profiled in a browser. Those questions must be closed — or that file
> deleted — before this becomes more than an experiment. The list at the bottom of
> THIS file is different: unfinished work, not undecided questions.

## The idea

A set of small stores, each owning exactly one thing, communicating by **native
JS events**. A store never reads another store's state to decide what to do; it
reacts to an event and, if it needs a fact, asks for that one fact.

A reader (a React hook, or a web component) does two things:

1. Subscribe to events for the one path it cares about.
2. On an event, **pull** the value from the store the event came from.

The event is a notification, never a payload. That is what keeps an edit's cost
proportional to the edited field instead of to the project.

## Two realms, and the line between them is drawn by closures

The constraint that decides the whole layout: **`Schema` instances carry the
user's `select`, `render` and custom `validate` closures, and closures cannot be
structured-cloned.** So anything that has to _execute_ one must sit next to one.

`executeRender` and custom `validate` both need an instance **and** the patched
source. Therefore patched source lives in the host realm too — otherwise every
render would ship a module across a thread boundary, and `handboka` is 129 KB.

```
HOST REALM (main thread)                      WORKER REALM
────────────────────────                      ────────────
host      ── Schema instances (closures)      search      ── index
source    ── patched source  ◄── read         patch sets  ── grouping
schema    ── serialized schemas               (schema validation)
patch     ── chain + head
stat      ── server truth
render    ── routes to host
validation── schema half → worker seam
             custom half → host seam
                              │
              ────────────────┴──── push (structured clone, lazy) ────►
```

- **Inside a realm**: native `CustomEvent` on each store's own `EventTarget`,
  plus plain synchronous **reads** (never mutations). Sync precisely _because_
  the realm is shared.
- **Across the worker seam**: nothing is observable — `EventTarget` dispatch is
  per-realm. So the host side explicitly subscribes and **pushes**, carrying the
  data with it. In `createSystem` those pushes are the `patchStore.events.on(...)
→ patchSetStore.insert(records, schemas)` calls at the bottom of the function.

### Why the worker-realm stores hold no store references

`SearchStore` and `PatchSetStore` take their data as **arguments**
(`buildIndex(snapshot)`, `insert(records, schemas)`) rather than reading a store.
That is not a style choice: they are across a thread boundary, so they _could
not_ read one. Putting the data in the signature makes the structured clone
visible, instead of hiding it behind a store reference that would silently stop
working the day they really move.

Only lazy, snapshot-shaped consumers belong there. Both are asked for answers
rarely — search opens, the review UI opens — so the clone is paid per session,
not per keystroke.

### Why not `SharedArrayBuffer`

It shares **bytes**, not object graphs, so a reader would `JSON.parse` per read —
more expensive than the `structuredClone` it replaces, which is native and does
not parse. It also demands cross-origin isolation (`COOP: same-origin` +
`COEP: require-corp`) of the whole embedding page, which a CMS overlay running
inside arbitrary customer apps cannot require. And it is fixed-size, while source
resizes on every patch, and needs `Atomics` locking that is banned on the main
thread.

The lever that actually works is **what** crosses, not how: path-scoped slices
instead of whole modules, and snapshots taken per session instead of per
keystroke.

## The host seam is a BUNDLE boundary, not a thread boundary

`ValProvider` takes `valModules` as a **prop from the host app**
([ValProvider.tsx:200](../components/ValProvider.tsx#L200)), which imports its own
`val.modules`. So the host's `Schema` instances and the SPA are in the **same
realm** but come from **different bundles**, each with its own copy of
`@valbuild/core`. Consequences, both load-bearing:

- Nothing may use `instanceof Schema` across it — the class identities differ.
  `extractValModules` already documents this; bracket access to
  `executeSerialize` / `executeRender` / `executeValidate` is the contract.
- **No clone is involved**, because no thread is crossed. `HostBridge` is async
  anyway, so an expensive `executeRender` can be deferred rather than blocking
  whoever asked — and so the seam survives if it ever does become a real
  boundary.

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
                    │                              │
                    │                     push ──► │ patch sets  (worker)
                    ▼
   host app ──► ┌──────┐  serialized   ┌──────────┐   source:patch-apply
   ValModules   │ host │──────────────►│  schema  │──┬──────────────┐
                │      │──────────────►│  source  │  │              │
                └──────┘               └────┬─────┘  │              ▼
                   ▲                        │        │        ┌──────────┐
      render ──────┘  executeRender         │        │        │  search  │ (worker)
      customValidate  executeValidate       │        └── push ►└──────────┘
                   ▲                        │
                   │                        ▼
              ┌────┴─────┐        per-path field events
              │ render   │        (external-patch / internal-patch)
              │validation│                 │
              └──────────┘                 ▼
                                  hooks / web components
```

## Render and validation are ROUTERS, not computers

Both own everything _around_ the work — the cache, the staleness, the events,
the per-path lookup — and route the work itself outward.

### Render store

`executeRender` runs the user's `render({ as, select })` closures, so only the
host can do it. The store's API is **per-path** (`get(path)`); underneath,
`executeRender` takes a whole module and returns
`ReifiedRender = Record<SourcePath, WithStatus<RenderTypes>>`, so one request
fills the cache for every path in the module.

The per-path interface is the point: making renders genuinely path-scoped needs a
new entry point in `packages/core`, and when it lands it lands behind this
signature with no caller changing.

**What this does and does not fix.** Today renders are computed eagerly, per
module, on every keystroke. This makes them lazy, cached, and de-duplicated
(concurrent readers of one module share a single host call). It does **not** fix
the worst case: `handboka` has `select` at two nested array levels, so one
request still walks every chapter and section. Lazy + cached turns that from
per-keystroke into per-change-then-read. Only path-scoping turns it into
per-visible-row.

### Validation store

Validation has two halves with different requirements, so it is a split rather
than one call:

| Half       | Needs                      | Seam   | Cost                                           |
| ---------- | -------------------------- | ------ | ---------------------------------------------- |
| **schema** | serialized schema + JSON   | worker | expensive, always needed, clone-transfers fine |
| **custom** | the real `Schema` instance | host   | only if the project declares validators        |

Routing everything to the host would be one code path, but it would put the
expensive half back on the host thread for every project — including the majority
that declare no custom validators at all and currently pay nothing.

The **walk** that finds where custom validators are declared runs in the store,
on the serialized schema. That is deliberate and not arbitrary: the serialized
schema can say a validator was _declared_ even though it cannot call one, whereas
the host holds an instance that can call one but cannot report that it skipped
any.

`executeValidate` on the real instance re-runs the schema checks too, so the two
halves overlap; results are merged and de-duplicated by message, or every field
in a custom-validated module would show each schema error twice. When the host
has no instance for the module, `customValidateStatus: "unavailable"` is reported
rather than the custom half being silently dropped — a green module that was
never fully checked is worse than an honest gap.

## Lazy is the point, for render, validation and search

All three react to a change by marking modules **stale** and saying so
(`render:invalidate`, `validation:invalidate`, `search:invalidate`), computing
nothing. Work happens when someone asks.

Typing 40 characters into one field costs 40 set-inserts and **zero** validations
and **zero** renders, against one validation round-trip _and_ one whole-module
render _per keystroke_ today.

All three also only **announce** staleness when it is news — when something
cached actually went stale. Without that rule, intake alone emits an invalidate
per module per store and the signal that matters drowns in it.

## Render and search run for what is being looked at

Neither may run because something CHANGED. The demand signal for a render is **a
listener existing at a path**; for search it is **a query**.

A listener is the system's own record that a field is on screen showing a path,
which makes it the only trustworthy signal that the work behind that path is
wanted. `get()` is not that signal: it is a caller choosing to pay, and a
speculative or already-unmounted caller can do that too.

Two moments, and the distinction between them is load-bearing:

- **Demand arriving** — a field mounts, so `source:listen` fires and the render
  is computed then. This is the "user clicks to a path that needs a render" case.
- **Demand disturbed** — the source changed under a field. This only MARKS.
  Recomputing here would cost one whole-module render per keystroke, which is the
  cost this design exists to remove. Nothing is lost by waiting, because the same
  call that changed the source wakes the fields on the affected paths, and a
  woken field re-reads — so the following read pays once, however many changes
  preceded it.

Demand leaving (`source:unlisten`) drops the module's cached render, so a module
nobody is looking at cannot be re-rendered by a later change to it.

Patch sets follow the same rule for a different reason: they are built from the
chain when the review UI asks, not accumulated per patch. The store always said
so; the wiring used not to.

## `.jsonValues()` should load through source, on the host — hypothesis

Not implemented, and recorded here because the prototype currently ignores
`.jsonValues()` entirely, which will not survive contact with a real project.

The shape the rest of this design implies:

A `.jsonValues()` record's on-disk source holds opaque `{_type:"json"}` MARKERS,
and each entry's content is fetched separately (`GET /json`). Today the engine
keeps that content in a field beside source (`jsonEntryContents`) and
`getPatchedSource` substitutes it in on read. That substitution is the right
idea and it belongs in the **source store**, for the same reason patched source
does: it is what every reader reads, and the host realm is where readers are.

What makes it fit rather than being extra machinery is that the demand signal is
already there. A read is `get(path, head)`, so a read at a path INSIDE an
unloaded entry is exactly the moment the content is wanted — the same rule as a
render being computed when a listener appears. So:

- a read inside an unloaded entry answers `module-loading` and starts the fetch;
- it must NOT answer `absent`, which is the trap the `absent` /
  `module-loading` split (invariant 3) exists to avoid: a path inside a marker is
  unknown, not missing, and collapsing the two makes a loaded-but-empty field
  indistinguishable from a field whose content has not arrived;
- the entry KEY SET is loaded even when no content is, so a read of the keys is
  `resolved-head` while a read inside an entry is `module-loading`. Two different
  answers about the same record, which is why the load state cannot be per
  module.

The consequence to carry into every walker: a walk over source is **partial**
while entries are markers. Search already treats a partial index as normal and
reports `staleModules`. Reference resolution and the delete/rename guards cannot
— `useJsonValuesLoad.ts` already establishes that contract, and it is worth
restating: "no references found" means nothing while entries are unloaded, so a
destructive action must gate on a status, never on an empty result. Custom
validation has the same problem and `collectCustomValidateTargets` already
returns `needsJsonKeys` for it.

Open: whether loading an entry bumps the head. It changes what a read returns
without being a patch, so either the head stops being the only staleness signal
for reads, or entry loads get their own revision. Probably the latter — a
content load is not an edit, and making it move the patch head would invalidate
every reader in the project for something no one edited.

## Files in patches: a file must exist for as long as anything references it

Bytes never travel inside a patch. They are POSTed directly — `POST
{baseUrl}/patches/{patchId}/files` in FS mode, straight to the content host in
HTTP mode — and the `file` op left in the patch carries a SHA-256 of what was
uploaded. `UploadFile` is the seam, injected like `fetchPatches`; **omitting it
makes the patch store REFUSE a patch carrying files**, rather than accepting one
and dropping the bytes.

That refusal is the shape of the whole problem. The server never reads a `file`
op's value as data — `ValOps` null-checks it, to decide whether to stamp
`patch_id` — so bytes left in a patch are not a slower route to the same result.
They produce no file, silently: the patch applies, source points at a path, and
nothing is there.

One rule decides all the ordering, and it explains why adding and removing are
mirror images:

|                  | order                 | why                                                                              |
| ---------------- | --------------------- | -------------------------------------------------------------------------------- |
| **add**          | upload → record patch | the patch is what REFERENCES the file, so the bytes must exist first             |
| **remove**       | record patch → delete | the patch is what STOPS referencing it, so deleting first strands the old source |
| **upload fails** | no patch at all       | nothing can reference what is not there                                          |

`data: null` is the delete, the same operation in both directions — which is how
the server already models it. One method, so a caller cannot upload through the
seam and delete around it.

### Rollback is garbage collection, not correctness

When one upload in a multi-file patch fails, the files that did land are deleted,
best effort, and the patch is not created. The correctness guarantee is the
"not created" half: nothing references anything missing. The cleanup is only
about wasted bytes, because an orphan is by definition unreferenced.

So a rollback that itself fails must not make things worse. It is REPORTED
(`orphaned`) rather than retried or thrown: the caller can still honestly say
"try again", and something knows those bytes are now garbage. There is no way to
make upload-then-record atomic and the design does not pretend there is — which
is also the argument for a server-side sweep of unreferenced patch files, since
`orphaned` is a list someone eventually has to act on.

Draft files are per PATCH, not per path: two pending edits to one path each keep
their own bytes, which is why a draft image URL carries a patch id at all. In FS
mode they are grouped under the patch's PARENT dir, so a second edit has to
parent on the first for the two to stay distinguishable.

## The invariants

### 1. If an event went out, the source behind it is already applied

The source store owns _both_ patch application _and_ the listener registry.
Because the same function does both, in that order, a field woken by an event
can read immediately and cannot get a pre-patch value. Structural, not a
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
registered path, and intersects a patch's touched paths against it. A field whose
path was not touched is **never invoked** — not "invoked and returns early".
That is what makes "this field got no messages" a guarantee rather than an
accident of a callback's own filtering.

Path matching is boundary-safe (`pathMatch.ts`): a raw `startsWith` would make
`?p="ab"` a child of `?p="a"`. Matching runs in **both** directions — a patch on
an ancestor changes my value underneath me; a patch under me changes the subtree
I render.

### 5. Events are observable in causal order

`StoreBus.emit` dispatches the wildcard **before** the named event. Dispatch is
synchronous, so a listener on the named event can emit its own consequence
before `emit` returns; named-first would deliver that consequence to an observer
_before its cause_, and a ledger reading `validation:invalidate` then
`schema:init` is useless for debugging exactly the ordering it exists to show.

## Why each store exists

| Store        | Realm  | Owns                                                | Why it is not folded into a neighbour                                                                                                                                                |
| ------------ | ------ | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `host`       | host   | the real `Schema` instances; intake                 | The only thing that may hold a closure. It defines the edge of what can be threaded, and it is the entry point, mirroring `setValModules`.                                           |
| `stat`       | host   | what the server says exists (patch **ids**, no ops) | The only store with an outside input. Keeping ops out of it is what makes `external-partial` a real state rather than a fiction.                                                     |
| `patch`      | host   | the linear chain, origins, which ids have data      | Knows a patch _exists_; the source store knows whether it _landed_. The head is where those two facts meet, so neither can compute it alone.                                         |
| `schema`     | host   | serialized schemas                                  | Own change sources (`/schema`, HMR swapping a schema under existing source) and own consumers (validation, render, search). Today they merely happen to arrive with source.          |
| `source`     | host   | patched source **and** the listener registry        | Invariant 1 requires them together. In the host realm because renders need it without a clone.                                                                                       |
| `render`     | host   | reified renders, cached and lazy                    | Owns caching/staleness so the host is asked once per change, not once per field per keystroke.                                                                                       |
| `validation` | host   | errors and their staleness                          | Coordinates the two-seam split above; neither seam can own the merge.                                                                                                                |
| `patch sets` | worker | patches grouped into reviewable units               | Answers _"what are the units of change?"_ — coalesced across many patches, only when the review UI is open. The source store answers _"who do I wake?"_ — exact, now, per keystroke. |
| `search`     | worker | the full-text index                                 | The most expensive walk in the system, so it must never be a side effect of an edit.                                                                                                 |

## Testing

`testSystem.ts` provides `initTestSystem()`: the real graph across both realms,
plus

- a **ledger** recording every event from every store's bus, in causal order
  (invariant 5), with `has(matcher, { since })` that waits and, on timeout, dumps
  the whole log — a system wired out of events fails by _not_ emitting, and
  "timed out" alone tells you nothing about which hop dropped it;
- **listeners** — `set(path)` registers a real field listener and gives you
  `didReceive(...)` and `noMessages({ since })`;
- a fake patch server behind the real `fetchPatches` seam, deliberately async so
  no store can come to depend on the fetch resolving synchronously;
- the **host store** itself, so a test drives intake the way the app does and can
  assert that a render or a custom validator really reached an instance.

`noMessages()` waits for the pipeline to quiesce _before_ asserting. Asserting
immediately would pass for a system that had not started yet — the most
dangerous kind of green test.

A representative ledger for intake + one local patch, which is what the flow
should look like:

```
host:receive → schema:init → source:init → search:invalidate
→ render:result → validation:result → search:build-index
→ patch:create → source:patch-apply → patch:head
→ render:invalidate → validation:invalidate → search:invalidate
→ patch-set:update
```

## Known gaps

Unfinished work, as distinct from the undecided questions in
[`openquestions.md`](./openquestions.md). Named so they are not mistaken for
finished work.

- **Renders are not path-scoped.** The interface is; the execution is not. This
  is the largest open question — it is what would fix the `handboka` worst case,
  and it needs a new entry point in `packages/core`.
- ~~**No rebase.**~~ **Done.** The source store now keeps base source and the
  per-module chain, and `receive()` genuinely rebuilds from base + chain. This
  also closed two defects that shared its cause: a patch announced before its
  module loaded was dropped for good (and left the head `partial` forever), and
  re-intake silently discarded pending local edits.
- **No real worker.** Both realms run in one thread today, behind the seams that
  would let them split (`SchemaValidationBridge`, and the snapshot arguments).
  Nothing has been wired to `postMessage`.
- **No per-module patch-set reset.** `PatchSets` has no per-module removal, so
  `PatchSetStore.reset(modules)` throws rather than quietly resetting everything.
- ~~**Search rebuilds whole.**~~ **Done.** Indexing is per module. The stated
  blocker — "incremental update needs a per-module document-id list" — turned out
  to be half wrong: the document ids ARE the source paths (`index.add(path, …)`),
  so nothing opaque was ever involved, and `SearchIndex` now keeps
  `docsByModule` only so removal costs O(that module) instead of O(the project).
  A query indexes what it owes and nothing else, and the gather is scoped to the
  same set — so one edit then one query no longer copies and re-walks every
  module.
- **`stat` has no real input.** No polling, no websocket, and it ignores
  `baseSha`/`schemaSha`/`sourcesSha`. Those are inputs to `schemaStore.receive`,
  not new events.
- **No local patch write-back.** `createPatch` never issues `PUT /patches`, so
  nothing exercises optimistic state, retry, or `patch-head-conflict`. File
  bytes DO now go through a real seam (`UploadFile`) with the ordering and
  rollback above; the patch itself still does not.
- **No hooks.** Nothing consumes any of this from React yet.
- ~~**Only the source/patch/stat path is tested.**~~ Host, render, validation,
  search and patch sets are now covered: `systemFlow` (one session-order flow),
  `systemInvariants` (one claim per test), `activityCost` (how many times each
  expensive thing runs), `demandDriven` (render and search only run for what is
  being looked at).
- **Unmeasured in a browser.** Work COUNTS are now asserted in node via the
  activity channel — see `activity.ts` — which is what caught render being put
  back on the keystroke path. Durations, and the absolute claim, still need a
  real profile.
