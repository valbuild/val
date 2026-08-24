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
      customValidate  executeValidate       │        ├── push ►└──────────┘
                   ▲                        │        │        ┌──────────┐
                   │                        │        └── push ►│references│ (worker)
                   │                        │                 └──────────┘
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

And the render itself is now scoped to the demand, not just triggered by it.
`RenderScope` (in `packages/core`) is passed to `executeRender`, so a listener on
one row of a list costs one `select` call instead of one per row; a request for
the CONTAINER still renders every row, because a list view needs all of them.
The cache entry carries the scope it was computed at — a render scoped to one row
answers for that row and nothing else, and serving it elsewhere would be wrong
rather than merely slow. See `openquestions.md` item 3 for the full reasoning,
including why `ListArrayRender.items` had to start carrying its indices.

Patch sets follow the same rule for a different reason: they are built from the
chain when the review UI asks, not accumulated per patch. The store always said
so; the wiring used not to.

## `.jsonValues()` loads through source, on the host

A `.jsonValues()` record's on-disk source holds opaque `{_type:"json"}` MARKERS,
and each entry's content lives in a separate `*.val.json` fetched on its own
(`GET /json`). The engine being replaced keeps that content in a field beside
source (`jsonEntryContents`) and `getPatchedSource` substitutes it in on read.
That substitution is the right idea and it lives in the **source store** here,
for the same reason patched source does: it is what every reader reads, and the
host realm is where readers are.

`substituteJsonEntries` is root-only and marker-guarded, matching the schema, and
copy-on-write — so a project using no `.jsonValues()` pays a `Map` lookup and
nothing else. `moduleSource()` caches the substituted source against the revision
it was computed at, because every in-realm walker (search, schema validation, the
custom-validate walk) asks for the same thing.

**The read is the demand signal, and the read WAITS.** A read at a path inside an
unloaded entry is exactly the moment the content is wanted — the same rule as a
render being computed when a listener appears. `get` triggers the fetch, awaits
it, re-resolves once and answers with the content:

- it must NOT answer `absent`, which is the trap the `absent` / `module-loading`
  split (invariant 3) exists to avoid: a path inside a marker is unknown, not
  missing, and a field told "not found" stops asking, so the entry never loads;
- it does not answer `module-loading` either, which an earlier draft of this
  section proposed. `module-loading` means "come back later", and nothing tells a
  caller when later is — so a field would poll or hang. It stays the right answer
  for an unloaded MODULE, where a read genuinely cannot help. `get` is already
  async, so **the awaited call IS the loading state**;
- `peek(path)` is the companion, and it is not optional: the moment a read can
  cause a fetch, anything that merely wants to LOOK — a nav menu counting
  entries, a badge, a progress indicator — becomes a fetch storm. `peek` reports
  `entry-missing` / `entry-loading` and cannot cost anything;
- concurrent readers of one entry share one fetch (`loadingEntries`), which is
  what makes N fields on one entry N reads and one request;
- a failed fetch is an `error`, never `absent`. "Not found" is a fact about the
  content; a failed request is a fact about the network, and a field shown "not
  found" has nothing to retry. With no `fetchJsonEntry` configured at all, a read
  inside an entry is likewise an error — "nobody can fetch it" is not "it is not
  there";
- the entry KEY SET is loaded even when no content is, so a read of the keys is
  `resolved-head` and a read of an entry's own value is the MARKER. Which is why
  load state cannot be per module: the same record answers definitively about its
  keys and indefinitely about what is inside them.

**Entry content arriving moves the module's revision.** This is settled by the
revision living in the source store rather than on the patch chain: `bump()` sits
next to each of the three assignments that change what a read returns — a patch
applying, a base-source replacement, and now `receiveJsonEntry`. A chain version
could not have covered it, and the earlier worry ("would that not invalidate
every reader in the project for something no one edited?") does not arise,
because the revision is PER MODULE and readers compare against their own.

The consequence to carry into every walker: a walk over source is **partial**
while entries are markers, and each walker now says so rather than looking
exhaustive.

- Search carries `complete` per module IN the snapshot — it has to, because the
  search store is across the worker seam and cannot ask the source store
  anything — and reports `partialModules` alongside `staleModules`. The two are
  deliberately separate: stale means "re-index me", incomplete means "load more
  content first", and a caller told to re-index would walk the same partial
  source again and change nothing.
- Validation reports `jsonEntriesLoaded`. `errors: false` on a module with
  unloaded entries means "nothing wrong in what I could see", which is a
  different claim from "this module is valid" — the same reason
  `customValidateStatus: "unavailable"` exists rather than the custom half being
  silently dropped. `collectCustomValidateTargets` already returns
  `needsJsonKeys` for the stronger case where a declared validator specifically
  needs entry content.
- Reference resolution and the delete/rename guards still have to be built, and
  `useJsonValuesLoad.ts` already establishes their contract: "no references
  found" means nothing while entries are unloaded, so a destructive action must
  gate on a status, never on an empty result.

`markJsonEntriesStale(module)` drops a module's loaded content for the case no
other fingerprint can see: an entry file changed on disk while the module's own
source (bare markers) stayed byte-identical, so `sourcesSha` does not move. That
is what the FS-only `jsonEntriesSha` exists for. Coarse by necessity — the
fingerprint cannot say WHICH entry — and cheap because of it: dropping content
causes no fetches, only the next read of an entry does.

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

### 2. A read hands back the REVISION it was computed at

`sourceStore.get(path, head | null)` always answers, and every answer that says
anything about the value carries the head behind it. Nothing asks the system
"what is current?" in order to then read — the read IS how you learn that.

The revision passed IN is a claim about what the caller has already
**incorporated**. Only two values are legal: `null` ("nothing yet") and a revision
a previous `get` returned. Quoting one obtained any other way asserts something
untrue, and the store will answer `unchanged` to a caller that holds nothing.

**The comparator is a per-module `Revision` owned by the SOURCE store, not the
patch head.** The patch head describes the chain, and the chain cannot see a
base-source replacement — a commit, `PUT /sources/~`, HMR, or a `.jsonValues()`
entry file changing on disk all change what a read returns without touching it.
A reader asks "did my value change?"; the chain answers "did the chain change?".
Those coincide for patches and diverge for everything else. `Revision` is bumped
from the two places that assign to `sources`, so every way source can change is
covered by construction, and adding a third way means adding one `bump()` beside
that assignment.

Per module rather than global: a patch in module A no longer makes a module-B
reader re-read. That matters most for `.jsonValues()`, where one local
`*.val.json` save marks every entry stale — under a global counter every mounted
field in the project would re-read for content it does not show. Being a pair
(`{module, n}`) also means a revision for the wrong module can never produce a
false `unchanged`.

Passing what you hold buys the cheap answer: if it is still current the reply is
`unchanged` and no value is marshalled — which, once source is behind a worker
seam, is the difference between a read costing a structured clone and costing
nothing.

**Out-of-order replies are handled by the reader, not by refusing.** Keep the
newest revision accepted and drop any reply not newer (`isNewerRevision`). Safe precisely
because a drop can only happen once something better has arrived, so there is
always a value and it is always the newest. This needs revisions ORDERABLE, so `Revision`
carries a monotonic `n` per module and comparison is one `<`. Comparing across
modules throws rather than answering `false`, which would let a reader treat a
foreign revision as "not newer" and keep stale data.

An earlier version refused a stale read and made the caller re-ask. That needed a
retry cap and was the one way the design could hang; answering always makes
progress in a single round trip.

The remaining hazard is a notification that is never delivered — a dropped event,
or a path-matching miss. Monotonic acceptance cannot see that, so
`isCurrent(head)` exists for a slow watchdog. A backstop, never the mechanism:
polling after every reply would double round trips and turn an ordering problem
into a loop.

The patch head is still **one global linear head**, mirroring the server's single
patch chain (`parentRef: { type: "patch", patchId }`) — but nothing reads it to
decide staleness any more, so its globalness costs nothing.

### 2b. Cycles are prevented structurally

1. A read is issued only on **mount** or on a **foreign event** — never in
   response to a reply. No reply→read edge, so no loop.
2. A reply is accepted or dropped. Dropping schedules nothing.
3. Events fire only for source that actually changed; a patch that fails to apply
   changes nothing, so it wakes nobody.
4. A field's own writes never wake it, so typing cannot feed itself.

Leaving `event → read → reply → (accept | drop)`, which terminates. The one route
back to a cycle is a field that WRITES on read — stated as a rule so it is not
left to convention.

### 3. `absent` is a different answer from `module-loading`

`absent` means _the module is loaded, its schema is loaded, and the path is not
there_. It is returned only when the store knows enough to say so; otherwise the
answer is `module-loading`, which says nothing about the path. Collapsing these
two is a long-standing bug source in the current engine, where
`source-not-found` means both.

### 3b. Suppression is per field INSTANCE

One path can be rendered twice — a studio field and an inline overlay — so what
is internal to one instance is foreign to the other. A listener registers with a
`fieldId`, a write carries one, and the patch store keeps `patchId → fieldId` for
patches created here. Dispatch skips exactly the listener that caused the patch;
everyone else on the path wakes. That is why the registry is one `EventTarget`
per (path, fieldId) rather than per path — a single target per path could only be
dispatched to wholesale.

The map is client-only and never persisted, because attribution is only ever
needed for patches made in THIS session: a patch from another tab is foreign to
every local field by definition. So it never has to survive a round trip, which
is why it is not encoded into the patch id — and could not be, since the server
validates `patchId.length === 36`.

### 4. Only registered paths are woken

The source store keeps a registry of watched paths, one `EventTarget` per
(registered path, field instance), and intersects a patch's touched paths against
it. A field whose
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

| Store        | Realm  | Owns                                                | Why it is not folded into a neighbour                                                                                                                                                                                                                                |
| ------------ | ------ | --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `host`       | host   | the real `Schema` instances; intake                 | The only thing that may hold a closure. It defines the edge of what can be threaded, and it is the entry point, mirroring `setValModules`.                                                                                                                           |
| `stat`       | host   | what the server says exists (patch **ids**, no ops) | The only store with an outside input. Keeping ops out of it is what makes `external-partial` a real state rather than a fiction.                                                                                                                                     |
| `patch`      | host   | the linear chain, origins, which ids have data      | Knows a patch _exists_; the source store knows whether it _landed_. The head is where those two facts meet, so neither can compute it alone.                                                                                                                         |
| `schema`     | host   | serialized schemas                                  | Own change sources (`/schema`, HMR swapping a schema under existing source) and own consumers (validation, render, search). Today they merely happen to arrive with source.                                                                                          |
| `source`     | host   | patched source **and** the listener registry        | Invariant 1 requires them together. In the host realm because renders need it without a clone.                                                                                                                                                                       |
| `render`     | host   | reified renders, cached and lazy                    | Owns caching/staleness so the host is asked once per change, not once per field per keystroke.                                                                                                                                                                       |
| `validation` | host   | errors and their staleness                          | Coordinates the two-seam split above; neither seam can own the merge.                                                                                                                                                                                                |
| `patch sets` | worker | patches grouped into reviewable units               | Answers _"what are the units of change?"_ — coalesced across many patches, only when the review UI is open, and INCREMENTALLY: a read after one keystroke inserts one patch, not the chain. The source store answers _"who do I wake?"_ — exact, now, per keystroke. |
| `search`     | worker | the full-text index                                 | The most expensive walk in the system, so it must never be a side effect of an edit.                                                                                                                                                                                 |
| `references` | worker | who points at what, per module                      | Answers _"is it safe to delete this?"_ — and only something that knows what is loaded can say whether the answer is exhaustive. Three separate whole-project walks in the app today.                                                                                 |

"Worker realm" in this table means **may not hold a host reference and must be
reachable through a cloneable, asynchronous API** — a constraint on the design,
which is what makes the split checkable. It is not a plan to put all three in a
worker. Measured (`bench/README.md`), only search is worth the crossing: reference
rescan hands the whole project over to do 2 ms of work, so a worker makes its
main-thread blocking 4.3x **worse**, and patch sets has nothing to move — it is
0.1 ms in-process. The constraint still earns its place for all three — it is what
forced the synchronous reads out of `createSystem` — but the placement it permits
is only taken where the number says so.

Patch sets got there by being fixed rather than by being measured differently.
That row first read 1.1 MB and 76x-worse blocking, which was a full rebuild of the
grouping plus every schema in the project on every read — not a cost of the seam.
See the correction in `openquestions.md` item 5; the general lesson is that a bad
seam number can be a defect on either side of the seam.

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

## References: who points at what, and whether that is all of them

Three questions in the app today, each with its own whole-project walk called
from its own React hook: `getKeysOf` (which `s.keyOf()` fields name this record),
`getReferencedFiles` (which image/file fields name this gallery),
`getRouteReferences` (which `s.route()` fields hold this route). Each re-walks
every leaf of every module, on every render of the component that asks.

They are the same walk. A referrer is a LEAF fact — this path, this kind, this
target, this value — so ONE index over those facts answers all three, and a
narrower question ("who points at THIS key", which is what a delete actually
asks) becomes a filter rather than another walk.

`ReferenceStore` is in the WORKER realm, for the same reason search is: the scan
needs serialized schemas and JSON source and nothing else. It is indexed per
module (`byModule`), so a keystroke marks its module stale and computes nothing,
and the next query re-walks that one module. Replacing a module's slice rather
than merging into it is load-bearing: **a stale referrer is the dangerous
direction** — it blocks a delete that is in fact safe, and the user has no way to
see why.

### Completeness is the answer, not metadata

`find()` returns `complete` or `partial`, not a bare array. The reason is that
these answers gate destructive actions, and "delete this key" is only safe on an
EXHAUSTIVE referrer list. A walk over a `.jsonValues()` record whose entry content
has not been fetched cannot be exhaustive — the referrer may be inside an entry
the walk saw as an opaque marker — so an empty array would read as "safe to
delete" and be wrong. `useJsonValuesLoad.ts` already states the contract; putting
it in the store's return type is what stops a caller gating on `refs.length`.

`refs` is populated in both states, because a reference that IS found is real.
Hiding it until everything is loaded shows "no references" for a record that
visibly has them.

What keeps this from meaning "load the whole project before you can delete
anything" is direction, the same argument `jsonValuesLoadRequirements` makes:
incompleteness is tracked **per referrer KIND**, decided from the item schema. A
jsonValues record of `{ body: s.string() }` cannot hide a `keyOf` however much of
it is unloaded, so a delete does not wait for it. Only a record whose item schema
actually contains a referrer of the asked-for kind blocks the answer.

### Two asymmetries worth knowing

- **`route` has no target.** `SerializedRouteSchema` carries include/exclude
  patterns and NOT the router it points into, so a route reference can only be
  matched by comparing the field's string VALUE. `Reference.target` is `null`
  there, named rather than left for a caller to discover.
- **A union is walked, not resolved.** Every variant is walked against the same
  source. A union's variants are structurally distinct, so a key present in the
  source belongs to at most one of them and walking all of them finds it without
  the discriminant. Over-walking costs a few misses; resolving wrongly LOSES a
  referrer, which is a delete that should have been blocked.

`at(path)` answers the inverse — what does the field here point at — from the
same index, because it is the same fact read the other way round. `KeyOfField`
and the validation fixes need it, and a second index of the same thing could go
stale differently.

## Measured, in a browser

Every cost claim above is an invocation COUNT asserted in node, and a count
cannot say whether the thing it counted takes 20 microseconds or 20
milliseconds. `../bench/` closes that: both systems run in a real Chromium, and
the unit of measurement is **a field becoming ready** — source, validation and
render in hand — because timing `addPatch` against `createPatch` would time the
eager system doing all the work and the lazy system doing none of it. See
`bench/README.md` for the fairness contract and `openquestions.md` item 1 for the
numbers, the provenance, and the corrections.

**The mount count was measured, not assumed**, and that mattered more than
anything else: earlier fixtures mounted 260, 1202 and 60 fields, and every one of
them reported a LOSS somewhere — because two costs here are linear in mounted
fields. Driving the real Studio over CDP against `examples/next` shows a screen
renders a compact preview row per field: **15–25 field components**, not 60 and
nowhere near 1202.

At that count (141 modules loaded, 16 fields on screen), 15 repetitions,
non-overlapping ranges:

| scenario                          | engine  | stores  |           |
| --------------------------------- | ------- | ------- | --------- |
| keystroke into a rendered list    | 18.3 ms | 0.4 ms  | **45.7x** |
| mount                             | 17.5 ms | 0.4 ms  | **43.8x** |
| keystroke                         | 17.0 ms | 0.4 ms  | **42.5x** |
| nested-row (the `handboka` shape) | 17.9 ms | 0.9 ms  | **19.9x** |
| burst of 40                       | 23.3 ms | 1.6 ms  | **14.6x** |
| intake                            | 71.1 ms | 8.2 ms  | **8.7x**  |
| list-view (whole list shown)      | 19.7 ms | 3.8 ms  | **5.2x**  |
| retained heap                     | 3722 KB | 2295 KB | **1.6x**  |

**At a real mount count there is no loss anywhere** — registration, the one
consistent loss across every earlier fixture, comes out with overlapping ranges.
At 60 fps a frame is 16.7 ms, so the engine's 17 ms keystroke is a dropped frame
per character. `select` runs 650 times in the engine and 2 in the stores on the
nested case; `list-view` runs 1200 in both, which is the honest control.

**With React mounted, one keystroke re-renders 16 components in the engine and 0
in the stores** — zero because per-path notification wakes only the changed path
and per-instance suppression means the typing field already holds its own value.
That is this design's central claim and the first measurement able to see it.

Three defects came back the other way, all fixed, and they are the argument for
keeping the harness rather than treating it as a one-off:

- `listenedPaths` walked the whole listener registry, making a mount
  O(fields x modules). Now indexed per module.
- Mounting rendered every module, spending most of its time inside
  `executeRender` on modules that declare no render. `SerializedSchema` carries
  `render?: true` and `SchemaStore.declaresRender` answers from the schema.
- **The listener scan was O(all registered paths) per patch.** The comment in
  `applyEntries` said exactly that while the design promised cost proportional to
  affected fields — and on a 1202-field mount a 40-key burst made the stores
  SLOWER than the engine. Now scoped to the changed modules' registered paths,
  equivalent by construction because `touchesPath` only matches within a module.

One cost remains, and only React could see it: **the stores render every field
twice on mount**, because `get` is async and the first commit paints nothing. In
the host realm that buys nothing, and whether to add a synchronous read is an open
question in `openquestions.md`.

## Known gaps

Unfinished work, as distinct from the undecided questions in
[`openquestions.md`](./openquestions.md). Named so they are not mistaken for
finished work.

- ~~**Renders are not path-scoped.**~~ **Done.** `RenderScope` in
  `packages/core` is threaded through every `executeRender`, so a listener on one
  row of a list costs one `select` call rather than one per row, and a nested list
  prunes the sibling subtrees. A request for a CONTAINER still renders all of it,
  because a list view needs every row. See `openquestions.md` item 3.
- ~~**No references store.**~~ **Done.** See below.
- ~~**No rebase.**~~ **Done.** The source store now keeps base source and the
  per-module chain, and `receive()` genuinely rebuilds from base + chain. This
  also closed two defects that shared its cause: a patch announced before its
  module loaded was dropped for good (and left the head `partial` forever), and
  re-intake silently discarded pending local edits.
- ~~**No real worker.**~~ **Crossable, crossed and measured — and only one of
  the three should go.** `workerBridge.ts` forwards each bridge over a
  `MessageEndpoint`, `workerEntry.ts` hosts the realm, and `workerBridge.test.ts`
  runs it in an actual `node:worker_threads` thread. Making it crossable required
  a real fix, not a wiring exercise: `createSystem` read across the seam
  SYNCHRONOUSLY in eight places, which across a thread boundary is impossible
  rather than slow (see `openquestions.md` item 5).
  Then it was measured, and the answer is per OPERATION, not per store: search
  should move (124 ms and 43.7 ms of never-yielding main thread, cut to 9.1 ms and
  0.2 ms), references must not (the walk is 2 ms and cloning the project to avoid
  it costs 9.5 ms), and patch sets has nothing to move at 0.1 ms in-process.
  Nothing is wired to a real `postMessage` in the shipped path yet, and after the
  measurement only search should be.
- **No per-module patch-set reset.** `PatchSets` has no per-module removal, so
  `PatchSetStore.reset(modules)` throws rather than quietly resetting everything.
- ~~**Search rebuilds whole.**~~ **Done.** Indexing is per module. The stated
  blocker — "incremental update needs a per-module document-id list" — turned out
  to be half wrong: the document ids ARE the source paths (`index.add(path, …)`),
  so nothing opaque was ever involved, and `SearchIndex` keeps
  `docsByModule` so that removal touches only that module's document ids. A query
  indexes what it owes and nothing else, and the gather is scoped to the same set
  — so one edit then one query no longer copies and re-walks every module.

  **Corrected by measurement:** this bullet used to claim removal therefore
  "costs O(that module) instead of O(the project)". That is wrong, and it is the
  kind of claim only a duration could catch. `docsByModule` bounds how many ids
  are removed; it does not bound the cost of removing one. FlexSearch's
  `index.remove(id)` scans the whole index unless the index was built with
  `fastupdate`, so removal is O(that module's docs × the project). Measured, an
  incremental reindex of ONE module costs **43 ms** of main thread that never
  yields — `bench/README.md`, "an adjacent finding". `fastupdate: true` cuts it to
  1.70 ms and breaks search (`index.search` returns `undefined` after a removal,
  caught by `systemFlow.test.ts`), so this is still open.

- **`stat` has no real input.** No polling, no websocket, and it ignores
  `baseSha`/`schemaSha`/`sourcesSha`. Those are inputs to `schemaStore.receive`,
  not new events.
- ~~**No local patch write-back.**~~ **Done, and the head model survives a 409.**
  `PatchSync` is the write-back loop and the one thing in this system that is NOT
  demand-driven: an edit has to reach the server whether or not anything reads it
  again, so it drives itself off `patch:create` rather than waiting to be asked.
  One `PUT` in flight at a time (the server checks every `parentRef`, so two is a
  409 by construction), everything unsaved in one batch (a batch shares one parent,
  so its members could not be sent separately anyway), and the parent computed from
  what the SERVER has acknowledged rather than from the local head.
  Optimistic state is a third axis — `PatchStore.pendingIds` — deliberately not
  folded into `Head`: a patch can be internal, applied and complete while existing
  only in this tab, and making the read path answer a durability question would
  force a reader to tell "not applied" from "not saved" out of one word.
  A 409 re-syncs and re-sends; a 400 drops the patches and rebuilds source from
  base + the surviving chain, since an applied patch cannot be un-applied. See
  `openquestions.md` item 6 for the four bugs this found, three of them in the
  design.
  Still a SEAM, like `FetchPatches` and `UploadFile`: nothing in the app calls
  `createSystem` yet, so the app-side implementation lands with the hooks.
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
