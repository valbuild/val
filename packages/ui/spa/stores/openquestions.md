# Open questions — close these, or delete this file

> **Rule:** this file must be empty (and deleted) before the store prototype
> becomes anything more than an experiment. Every item below is a decision or a
> measurement that is currently missing, not a task that is merely unfinished —
> the unfinished-work list lives at the bottom of `architecture.md`.
>
> Items are ordered by how much other work they invalidate if answered the other
> way.

---

## 1. ~~Nothing has been measured IN A BROWSER~~ — MEASURED. 🟢 GO

**The question was:** does per-path eventing + lazy compute actually beat the
current engine, in a browser? Every performance claim in `architecture.md` was
read off the code, and `ValSyncEngine` had already had four fixes landed (#476) —
it was entirely possible those bought most of the available win.

**Answered, and it is not close.** `bench/` runs both systems in a real Chromium.
The fairness contract is at the top of `bench/drivers.ts`; the short version is
that the unit of measurement is **a field becoming ready** (source + validation +
render in hand), because timing `addPatch` against `createPatch` would time the
eager system doing all the work and the lazy system doing none of it.

### First, the fixture — because it decided the answer three times

**Every claim of a LOSS in earlier revisions of this section came from a fixture
that mounted too many fields**, and two of the costs measured here are linear in
mounted fields: listener registration, and the per-path read cache.

The counts went 260 (2 fields in each of 120 modules), then 1202 (60 in each of
20), then 60 (all of one page). A reviewer asked why a benchmark was registering
260 listeners when there should be one per rendered field. The count was right —
one each — but the number of fields was not, and the question was the right one.

So it was **measured against the real thing**: `examples/next` running for real,
Next dev server plus the UI's Vite dev server, with the Studio driven over CDP.

- `/~/app/page.val.ts` — the richest real module (object, array, `keyOf`,
  `route`, richtext, file): a content area of 63 elements, **~15 field rows**.
- `/~/content/handbook.val.ts` — the 24-chapter list: 507 elements, 74 buttons,
  **~24 rows**.

The Studio renders a compact PREVIEW row per field, not a form full of inputs. A
screen is **15–25 field components**. Every earlier fixture was 3x to 50x over.

`SIZES.screen` is that shape: 141 modules loaded, 16 fields mounted in one
module. The inflated sizes are kept as diagnostic instruments — mounting far more
than is real is how the O(registered paths) listener scan was found, and it was
found on `page` and nowhere else — but they are not descriptions of a session.

### screen — 141 modules loaded, 16 fields on one open screen

15 repetitions, medians, all ranges non-overlapping unless marked:

| scenario                          | engine  | stores  |                     |
| --------------------------------- | ------- | ------- | ------------------- |
| keystroke into a rendered list    | 18.3 ms | 0.4 ms  | **45.7x**           |
| mount (register + first paint)    | 17.5 ms | 0.4 ms  | **43.8x**           |
| keystroke                         | 17.0 ms | 0.4 ms  | **42.5x**           |
| nested-row (the `handboka` shape) | 17.9 ms | 0.9 ms  | **19.9x**           |
| burst of 40                       | 23.3 ms | 1.6 ms  | **14.6x**           |
| intake                            | 71.1 ms | 8.2 ms  | **8.7x**            |
| list-view (whole list shown)      | 19.7 ms | 3.8 ms  | **5.2x**            |
| retained heap                     | 3722 KB | 2295 KB | **1.6x**            |
| mount, registration only          | 0.1 ms  | 0.2 ms  | 0.5x? (overlapping) |

**At the measured mount count there is no loss anywhere.** Registration — the one
consistent loss across every earlier fixture — is 0.1 ms against 0.2 ms with
overlapping ranges. It was never a real cost at a real field count.

**The engine spends 17 ms on one character.** At 60 fps a frame is 16.7 ms, so
that is a dropped frame per keystroke on a realistic screen. Where it goes:
`getSourceSnapshot` deep-clones the whole module per read, and the per-path
validation getter delegates to `getAllValidationErrorsSnapshot`, which is cached
and invalidated by every patch — so the first read after a keystroke rebuilds
validation errors for the **entire project**. That is the "cost proportional to
the project" thesis, measured.

The `select` counts say it from the other side: `nested-row` runs `select` **650**
times in the engine and **2** in the stores for the same one field ready.
`list-view` runs 1200 in both — the honest control, since with the whole list on
screen there is nothing to scope away, and its remaining 5.2x is not about
renders at all.

### With React mounted

| driver | mount ms | mount renders | keystroke ms | **keystroke renders** |
| ------ | -------- | ------------- | ------------ | --------------------- |
| engine | 0.5      | 16            | 0.6          | **16**                |
| stores | 1.0      | 32            | 0.2          | **0**                 |

The engine's finest source subscription is `subscribe("source", module)` — its
API, used exactly that way by `ValFieldProvider.tsx` — so typing into one field
notifies every field of the open module. **Zero for the stores, not one:**
per-path notification wakes only the changed path, and per-instance suppression
means the field that typed the character already holds it.

Two qualifications:

- **The stores render every field TWICE on mount** — 32 against 16, in every
  shape. `get` is async, so the first commit paints nothing and a second render
  follows when the read lands: a flash of empty fields. It is the async
  protocol's cost, and in the host realm it buys nothing. See the open item.
- **The millisecond column is a floor.** The harness's field is a `<span>`; a
  real Val field is a rich-text editor. Read the render COUNT.

### The defects the measurement found

Three, all real, all fixed. This is the argument for keeping the harness:

1. `listenedPaths(module)` walked the whole listener registry, making a mount
   O(fields x modules). Now indexed per module.
2. Mounting rendered every module — ~2.3 ms of 3.1 ms inside `executeRender` on
   modules that declare no render. `SerializedSchema` carries `render?: true` and
   `SchemaStore.declaresRender` answers from the schema.
3. **The listener scan was O(all registered paths) per patch.** On the
   1202-field shape a 40-key burst walked all 1202 paths 40 times and made the
   stores **slower than the engine** (12.8 ms vs 9.2 ms). The comment in
   `applyEntries` said the scan was O(registered paths) while the design promised
   cost proportional to affected fields; those are not the same thing. Now scoped
   to the changed modules' paths — equivalent by construction, because
   `touchesPath` only matches within one module.

### Corrections to earlier revisions of this section

Kept because the pattern matters more than the numbers: **every wrong conclusion
here came from the fixture, not the code.**

- "intake 7.8x, keystroke 3.1x, nested-row 5.2x" from one 7-rep run of one
  shape. All understated; keystroke is 42.5x on a measured screen.
- "Mounting went from 2.5x slower to a wash." It was a loss on three fixtures and
  is a **43.8x win** at the real mount count.
- "Registration is ~10x slower, a trade rather than a free win." At 16 mounted
  fields the ranges overlap. There is no trade.
- "The engine will use visibly more memory" → measured 1.0x → concluded the
  prediction was wrong → at a real mount count it is **1.6x in the stores'
  favour**. Both earlier conclusions were premature.

- [x] Build the harness; record durations for both systems.
- [x] Decide go/no-go. **Go.**
- [x] Memory.
- [x] React in the loop.
- [x] A mount count measured against the real Studio, not assumed.
- [x] A real project of the right shape — `examples/next` now carries a 344 KB
      generated handbook (`pnpm handbook generate`) with `select` at two nested
      array levels, which is the `handboka` shape in an app that really builds and
      really validates.
- [ ] **Decide: should the host realm get a synchronous read?** The double mount
      render is the async protocol's cost, and in the host realm source is right
      there. A `readSync(path, revision)` alongside `get` would remove the wasted
      renders, at the price of a second read API and a rule about which one a
      field may use.
- [ ] Drive the bench from the `examples/next` modules themselves, not only from
      generated ones of the same shape.

---

## 2. A field is woken by its own edit. 🟢 DECIDED — being implemented

**Decided (2026-08-22).** Suppression is per FIELD INSTANCE, and the read hands
back the head instead of the field asking for it.

The read protocol:

- `get(path, head | null)` returns the source **and** the head it was computed
  at. `null` means "I hold nothing yet".
- It never refuses. The earlier `resolved-out-of-date` made the caller re-ask,
  which needed a retry cap and was the one way the design could hang. Answering
  always makes progress in one round trip.
- Passing the head you hold buys the cheap path: if it is still current the answer
  is `unchanged` and no value is marshalled — which is what keeps a read
  affordable once source is across a worker seam.
- `isCurrent(head)` is the same question without the value, for a watchdog.

**Out-of-order replies are handled at the field, by monotonic acceptance.** Every
reply carries the head it was computed at; the field keeps the newest head it has
accepted and DISCARDS any reply not newer. Discarding is safe precisely because it
can only happen once something better has arrived, so the field always holds the
newest value. This needs heads to be orderable, so `Head` carries a monotonic
`seq` (the patch store's chain version) and comparison is one `<`.

Rejected: _asking for the head after every response_ — it doubles round trips and
converts an ordering problem into a retry loop that need not converge. Kept only
as a slow watchdog, using `isCurrent`, to catch a LOST event (a dropped
notification, or a path-matching miss like the array-shift defect); it is a
backstop, never the mechanism.

**Attribution is per field instance, client-side.** The same path can be rendered
more than once — studio field and inline overlay — so what is internal to one
instance is foreign to the other. A listener registers with a `fieldId`; a write
carries one; the patch store keeps `patchId → fieldId` for patches created in this
session, and dispatch skips only the listener that caused the patch. Everyone else
wakes.

Rejected: _encoding the field id inside the patch id_. The instinct was right —
the patch id is the one thing the server echoes back, since `sessionId` is sent on
`PUT /patches` and never returned. But `ValServer` validates
`patchId.length === 36`, so there is no room to prefix without eating random bits
and risking collisions between fields; it would persist a UI-lifetime concern into
the chain, the review UI, upload paths and `?patch_id=` URLs forever; and it is
unnecessary, because attribution is only ever needed for patches created in THIS
session — anything from another tab is foreign to every local field by definition.
`ValSyncEngine` already keeps exactly this map as `creatorId`; what was broken was
never the map but the rule on top of it (`isEditedByComponent` asks "is my last
patch the last patch overall?", which fails under concurrent edits).

### Cycles are prevented structurally, not by convention

1. A read is issued only on **mount** or on a **foreign event** — never in
   response to a reply. No reply→read edge, so no loop.
2. A reply is accepted or dropped. Dropping schedules nothing.
3. Events fire only for source that actually changed; a patch that fails to apply
   changes nothing.
4. A field's own writes never wake it, so typing cannot feed itself.

Leaving `event → read → reply → (accept | drop)`, which terminates. The one way
back to a cycle is a field that WRITES on read — stated as a rule so it is not
left to convention.

### ~~The comparator is in the wrong store~~ — FIXED

`head.seq` is the PATCH STORE's chain version, and the patch chain cannot see a
base-source replacement. So a source reset — a new commit, `PUT /sources/~`, HMR,
or a `.jsonValues()` entry file changing on disk — changes the value while the
comparator sits still, and a field quoting the head it correctly read at is told
`unchanged` about a value that is now wrong. Confirmed: held `"authored"` at
`seq 0`, re-received as `"changed on disk"`, re-read answered
`{status:"unchanged", seq:0}`. Two failing specs in `headProtocol.test.ts`.

Note this is NOT jsonValues-specific — it hits ordinary HMR. jsonValues only
makes it likelier, because an entry file change cannot move `sourcesSha` either:
the module's source is markers and the content sits behind a thunk
`JSON.stringify` drops, which is exactly why `jsonEntriesSha` exists as its own
fingerprint (FS mode only).

**Done.** `Revision` — `{module, n}` — is owned by the source store and bumped from
the two assignments that mutate source. The patch head keeps describing the chain
for the review UI and `parentRef`, and `PatchStore.chainVersion()` keeps its real
job of telling the lazy patch sets the chain moved. Each counter now answers the
question it is named for. Both specs green, plus two new ones pinning that a
change in one module does not stale a reader of another and that a revision from
the wrong module can never produce a false `unchanged`.

### How `.jsonValues()` content can change at all

Only two ways, and both are already modelled:

1. **A patch**, exactly like any other source. Goes through the chain, so the
   comparator moves and `unchanged` is correctly refused.
2. **A source reset** — a new commit (`sourcesSha`), or an entry file changing
   locally (`jsonEntriesSha` → `markAllJsonEntriesStale`).

There is no third path, which is what makes the revision split sufficient rather
than merely helpful: cover "the chain moved" and "base was replaced" and every
way content can change is covered.

Implementing it added a third _assignment_ rather than a third path: content
ARRIVING (`receiveJsonEntry`) changes what a read returns without being either of
the two above. It gets a `bump()` next to the assignment, which is the whole point
of the revision living in the source store — a new way to change source is one
line at the mutation, not a notification another store has to remember to send.

### ~~Does loading an entry move the head?~~ — ANSWERED

Two questions were tangled here and separating them dissolved it:

- _does loading change what a read returns?_ Yes, so it moves the module's
  REVISION. Per module, so a reader of another module is unaffected.
- _does loading belong to the patch chain?_ No. It is not an edit, has no patch
  id, and must not appear in the review UI or in `parentRef`.

The comparator split is what let both answers stand at once. Before it there was
one counter and the two answers contradicted each other.

### ~~`get` inside an unloaded entry answers `module-loading`~~ — SUPERSEDED

The original draft had a read inside an unloaded entry answer `module-loading` and
start the fetch. Wrong, and worth keeping the reason: `module-loading` says "come
back later" and nothing tells a caller when later is, so a field would poll or
hang. `get` is already async — the awaited call IS the loading state. It triggers
the fetch, awaits it, re-resolves once and answers with the content.

That makes `get` a read with a side effect, which needs the companion it now has:
`peek(path)` reports `entry-missing` / `entry-loading` and cannot cost anything,
so a nav menu counting entries does not become a fetch storm. `module-loading`
survives for an unloaded MODULE, where a read genuinely cannot help — that is the
distinction, not "loaded vs not".

### Still open

- [ ] `getHead()` stays for tests and for the patch store's own use, but nothing
      field-facing may call it. Worth an eslint rule rather than a comment?
- [ ] The watchdog interval is unpicked. It must be slow enough not to be a
      polling loop and use `isCurrent` so a quiet system does zero reads.
- [ ] Does a field re-read on REMOUNT, or can it trust a head it held before
      unmounting? Trusting it is wrong if the store dropped the module meanwhile.

## 2b. Original framing, kept for the reasoning 🔴

**The question:** is `PatchOrigin` (`internal` / `external`) the right
granularity, or does an event need to name the field instance that caused it?

Today `SourceStore.applyPatches` dispatches to **every** registered listener
whose path matches — including the listener belonging to the field that just made
the edit. Origin is _session_-level, so a field typing into itself receives
`internal-patch` for its own keystroke, re-reads, and can overwrite what the user
is mid-way through typing. That is the flash-back bug the current engine papers
over with the `isEditedByComponent` heuristic ("is my last patch the last patch
overall?").

The complication that makes this a real question rather than an oversight: **two
field instances on the same path must both update** — the studio field and the
inline overlay field are different components showing one path. So "suppress
echoes for this path" is wrong; it has to be "suppress echoes for this
_instance_".

Options:

| Option                                                     | Kills the echo | Studio+overlay both update | Cost                                                         |
| ---------------------------------------------------------- | -------------- | -------------------------- | ------------------------------------------------------------ |
| Keep session-level origin, field ignores `internal-patch`  | yes            | **no**                     | free, but breaks the overlay                                 |
| Add `originFieldId` to the write and to `FieldEvent`       | yes            | yes                        | write API grows an id; store threads it through apply        |
| Uncontrolled fields — DOM value is the truth while editing | sidesteps it   | yes                        | fields stop being controlled; needs `resetKey`-style remount |

- [ ] Decide. The second and third are complementary, not alternatives.

**Recommendation:** `originFieldId` on the write and on `FieldEvent`. It is a
small change now and it is load-bearing for every field that follows, so it is
much cheaper before hooks exist than after.

---

## 3. ~~Renders are not path-scoped~~ — FIXED, in `packages/core`

**Was:** `RenderStore.get(path)` is per-path, but `executeRender` took a whole
module, so one request walked everything. For `handboka` — `select` at two nested
array levels — that was every chapter and every section on any change to the
module. Measured: one listener on one row of a three-row list cost **3** `select`
invocations to serve **1**.

**Done**, once changing `packages/core` was allowed (decided 2026-08-23: no
external users, two internal ones).

`RenderScope` in `packages/core/src/render.ts` is threaded as an optional third
argument through every `executeRender`. It answers two questions, and the split
is the whole design:

- `wants(path)` — is a render AT this exact path wanted? A container answers
  `true` when the whole of it is being shown, and its list render is computed in
  full. **A list VIEW asks for the container and needs every row**, so windowing
  there would be a list with rows missing — a broken screen, not a saving.
- `wantsUnder(path)` — could anything at or below this path be wanted? Recursion
  is pruned where this is `false`, and a container whose own path is NOT wanted
  but which has wanted descendants renders a **window**: only the items asked
  for. That is what a single visible row is.

It compares path SEGMENTS, not string prefixes. `"title"` is a string prefix of
`"titles"` but not a path ancestor of it, and a key may contain a dot or a quote,
so `startsWith` silently renders siblings. Pinned in `render.test.ts`.

`ListArrayRender.items` became `[index, value][]` — the shape
`ListRecordRender` already had. This is the load-bearing part: a windowed render
is a SHORTER array, so a consumer reading `items[n]` positionally would get a
different row. Carrying the index makes that unrepresentable, and the compiler
pointed at both UI call sites (`SortableList.tsx`, `useRefPreview.ts`) rather
than letting them read the wrong row at runtime.

A side effect worth naming: `array`'s `select` is now wrapped per ITEM rather
than per list, matching what `record` already did. Before, one throwing row
produced an error at the container and NO items at all — one bad row took out the
whole list.

Above core, `RenderStore` had to learn two things:

- **The cache entry carries the scope it was computed at.** A render scoped to
  one visible row says nothing about another row, and serving it there is worse
  than a cache miss — a miss is slow, that is wrong. Coverage is asked per
  CALLER, not "is every listened path covered": folding those together makes one
  field's read pay for everyone else's, which is the fan-out being removed.
- **Concurrent readers of different paths must still cost one render.** Sharing
  an already-issued request cannot do it, because its scope was fixed when it was
  issued. `refreshFor` collects the asked-for paths across the turn (one
  microtask) and issues once. The in-flight map carries its scope too, so a
  request that will not answer the caller's question is not mistaken for one that
  will; that case retries exactly once and then issues unconditionally, because a
  duplicate render costs time whereas a wrong `no-render-at-path` is a bug.

The eager `source:listen` path deliberately does NOT wait a microtask: it is
dispatched synchronously from `addListener`, and "the render is ready when the
mounting field first looks" is the whole promise of computing on demand arriving.
Only the FIRST listener in a module triggers it — twenty rows mounting would
otherwise refresh twenty times at growing scope, strictly worse than the one
whole-module render this replaces. The other nineteen are covered by their own
reads, and the first of those renders at the scope of everything mounted by then:
**twenty rows cost two renders, not twenty.**

Four callers of `executeRender` remain; only `HostStore` passes a scope.
`ValOps.ts:595` (server) and `InlineField.stories.tsx:70` want whole modules and
pass nothing, which is exactly the old behaviour.

## 4. `executeValidate` has no custom-only mode, so errors are merged by message. 🟡

**The question:** should core expose "run only the custom validators", or is
de-duplication by message good enough?

The schema half runs across the worker seam; the custom half runs on the host via
`executeValidate` — which **re-runs the schema checks too**. So the two results
overlap, and `ValidationStore.mergeValidationErrors` de-duplicates by
`error.message` at each path.

That is a heuristic, and it is wrong in one identifiable case: two genuinely
different errors at the same path with the same message collapse into one. Whether
that ever happens in practice is unknown.

- [ ] Either add a custom-only entry point to core (removes the overlap
      entirely), or confirm message-level de-duplication is acceptable and say
      why.

**Recommendation:** a custom-only entry point. It also removes a duplicated
schema walk per validation, so it is a perf answer as well as a correctness one.

---

## 5. The worker seam — CROSSED, in a real thread. 🟢 Measurement pending

**The question was:** three stores are declared worker-realm. Would they actually
survive a thread boundary, or is "worker realm" a comment?

Two things have to be true, and they fail differently.

### 1. Everything crossing must be structured-cloneable — TRUE, and now guarded

`workerSeam.test.ts` runs every payload through `structuredClone`, which IS the
`postMessage` algorithm, so it fails with the same `DataCloneError` a worker
would throw — without needing a worker. Covered: the search snapshot and its
result, the reference snapshot / query / scan / `Reference`, the patch records
and schemas handed to the patch-set store, and every return value.

Two stronger assertions, because cloneable is not the property actually relied
on: **a serialized schema is JSON** and **module source is JSON**. `structuredClone`
would happily carry a `RegExp` or a `Map`; JSON round-tripping is what lets these
be cached, hashed and compared by value. `HostStore.receive` JSON round-trips
source on intake precisely so this holds, and that guarantee is now asserted
where it is relied on rather than only where it is created.

All green. Nothing in the design was hiding a closure.

### 2. Nothing may be read SYNCHRONOUSLY across the seam — WAS FALSE. Fixed.

This is the one cloneability could never have found, and it is why the seam was
worth testing before it was worth building. A value can be perfectly cloneable
and still unreachable: across a thread boundary **a read is a message**, so a
synchronous signature cannot be crossed at all.

`createSystem` did it in eight places:

    searchStore.needsIndex()        searchStore.staleModules()
    searchStore.indexedModules()    searchStore.markStale(modules)
    referenceStore.staleModules()   referenceStore.scannedModules()
    referenceStore.find(query)      referenceStore.at(path)

So the code as written **could not have worked** across a real seam. Not slower —
impossible. "A seam that is never crossed is a comment" turned out to understate
it: the comment was wrong.

The fix was forced by what the information IS. **The host is the side that knows
a module changed** — it emits `source:patch-apply`. It was pushing that into the
worker store and then asking the worker back what it owed, which across a seam is
four messages for something already in hand. So:

- `StaleModules` (host) owns the stale set, the covered set, and the decision
  about what to gather. One instance per consumer, because the search index and
  the reference index go stale independently.
- The worker-realm stores are now pure: handed a snapshot and a query, they
  answer. `find`, `at` and `forget` became `async` — not because they compute
  asynchronously, but because their SIGNATURE has to be crossable.
- `SearchResult` split in two. `WorkerSearchResult` is what the worker can say
  (results, total, `partialModules` — completeness travels in the snapshot);
  `SearchResult` adds `staleModules` from host state, joined at the system
  boundary. Each realm reports what it knows and neither interrogates the other.

A consequence worth naming: through `system.search()`, `staleModules` is now
almost always empty, because the query reconciles the index before answering.
What it reports now is "modules a pass could not cover" — one with no schema or no
source stays stale, since `covers()` is called with what the worker actually
indexed rather than with what was asked for. `systemFlow.test.ts` was updated to
assert the stronger guarantee this enables: after an edit the query returns the
NEW value and the old one is gone, rather than reporting itself behind.

### 3. The bridge exists, and the stores run in a REAL thread

`workerBridge.ts` is the crossing: `SearchBridge`, `PatchSetBridge` and
`ReferenceBridge` — which the three stores already satisfy **structurally**,
because making the seam crossable meant making every method `async` and every
input an argument. So the in-process default costs nothing and a real worker
drops in through `SystemOptions.workerRealm` with no caller changing. Exactly the
shape `SchemaValidationBridge` already had.

`workerEntry.ts` is the realm split made executable — look at its imports: three
stores, an activity sink, a transport. Nothing that could hold a closure.

`workerBridge.test.ts` runs it in an actual `node:worker_threads` thread: an index
built in the other thread answers a query from the host, references are scanned
and `find`/`at` answered over the wire, patch sets are built there. Plus the
failure modes, because a message-passing bridge fails silently by default: an
unknown method REPLIES with an error rather than leaving the caller waiting, a
non-cloneable payload rejects **at the call that sent it** (with a message naming
the call rather than an unhandled rejection with no stack), and `dispose` rejects
what is in flight — a promise that never settles is the one outcome a caller can
neither render nor retry.

Two things learned in the doing, both recorded in the test:

- The worker must load via `tsx/cjs`, not `--import tsx`. The ESM loader does not
  resolve extensionless relative specifiers, so `workerEntry`'s
  `import { SearchStore } from "./SearchStore"` dies with ERR_MODULE_NOT_FOUND —
  which reads as "the worker realm cannot load" when it is really "this loader
  cannot resolve". A shipped browser worker loads the bundled entry and has no
  such problem.
- **Loading is not what enforces the split.** `HostStore` loads fine in a worker;
  it imports only from core. The boundary is enforced by what a value can CARRY —
  a `Schema` instance holds closures, and a closure cannot be cloned. Asserted
  honestly, because "the worker entry imported fine" invites the wrong conclusion.

`jest.config.js` also grew a `modulePathIgnorePatterns` for `.claude/worktrees/`:
a git worktree inside the repo puts a second copy of every workspace package in
jest's haste map, and EVERY suite then fails with "looked up in the Haste module
map" — a failure with nothing to do with the code under test.

### Still to do

- [ ] **Measure it.** A worker moves work off the main thread and adds a clone
      per call; `bench/` is the place to find out whether that trade is worth
      taking, and for which store. The patch-set store is the likeliest win (a
      whole-chain rebuild) and the reference store the likeliest loss (small,
      frequent queries). Nothing should move to a worker before that number
      exists — the same discipline item 1 applied to the stores themselves.
- [ ] **Decide about the two per-realm losses.** With a real worker, the worker
      stores' events and activity records do not reach the host, so an
      instrumented run has two ledgers and `activityCost.test.ts`-style
      assertions about worker work would have to read the worker's. Forwarding
      them is possible and deliberately not done: every event would become a
      message, and the point of `noopActivity` is that an uninstrumented run pays
      one returning call.

## 6. Nothing is written back to the server. 🟡

**The question:** is the head model right once writes can fail?

`PatchStore.createPatch` records a patch locally and never issues
`PUT /patches`. So none of this is exercised:

- optimistic state — a patch that exists locally and not yet on the server;
- retry and `patch-head-conflict` (409) — the server rejecting a patch whose
  parent is no longer the head;
- `Head` of `internal-partial` — currently reachable in theory and never in fact.

The head handshake is the core safety property of the read path, and it has only
ever been tested against writes that cannot fail.

- [ ] Wire `PUT /patches` and confirm the head model survives a 409.

---

## 7. ~~HMR will break, because there is no rebase.~~ ✅ CLOSED

**The question:** where does base source live?

HMR re-runs intake with new base source for a module that already has patches on
top. That needs "replace base for M, re-apply M's chain, bump M". The source
store deliberately keeps **no** base source — holding one that nothing reads
would read as though rebase worked.

`PUT /sources/~` needs the same operation, so it is not HMR-only machinery.

- [x] Base source lives in the **source store**, alongside a per-module chain of
      every record it has seen. `receive()` replays the chain onto the new base,
      so the comment claiming it already did this is now true. Closing this also
      closed two defects with the same cause: a patch announced before its module
      loaded was lost for good and left the head `partial` forever, and re-intake
      silently discarded the user's pending edits.

---

## 8. `stat` has no input at all. 🟡

No polling, no websocket. It also ignores `baseSha` / `schemaSha` / `sourcesSha`,
which is how the real client learns it must refetch schemas or sources.

- [ ] Confirm those shas are inputs to `SchemaStore.receive` / `SourceStore.receive`
      and not new events, then wire one real input so the pipeline has a source.

---

## 9. ~~Five of the nine stores have no committed test.~~ ✅ CLOSED

`host`, `render`, `validation`, `search` and `patch sets` were verified end to end
by hand — render routed through the host, a custom validator's own message came
back, search and patch sets worked off pushed snapshots — and that scratch test
was **deleted** rather than committed, per instruction.

`system.test.ts` covers only the source / patch / stat path.

- [x] Committed. `systemFlow` walks one session in order; `systemInvariants`
      takes one claim per test; `activityCost` asserts how many times each
      expensive thing runs; `demandDriven` asserts that render and search run
      only for what is being looked at. Between them they found six defects, of
      which five are fixed and one — item 3 — needs the decision below.

---

## 9b. The `.jsonValues()` key↔file mapping is canonical but UNENFORCED 🔴

**Raised in review, and the reviewer was right where I was wrong.** My first answer
here said the mapping was 1:1 but "not derivable — there is no naming rule between
key and file". That is false. There IS a naming rule, it is canonical, and it is
already implemented.

`getNewJsonEntryPaths(moduleFilePath, entryKey)` in
`packages/server/src/patch/jsonValuesPatch.ts`:

```
/content/kb.val.ts  +  key "kb-000"   ->   /content/kb/kb-000.val.json
```

The key IS the filename. The directory IS the module name minus `.val.ts`. Both
write paths go through it — the `jsonValues:extract-entry` fix
(`extractJsonValuesEntry.ts`) and the patch commit — so anything Val itself
produces is canonical, and the intended authoring flow is exactly what the
reviewer described: the user writes normal data, and `--fix` extracts it to the
derived path.

### The defect: nothing checks it

`validateJsonValuesEntries` (`packages/server/src/validateJsonValues.ts`) checks
two things — that the entry is not written inline, and that its CONTENT matches the
item schema. It gets the content by calling the thunk. **It never compares the
thunk's target to the canonical path.** So a module can point a key at any file in
the project and pass validation.

This is not hypothetical. The repo's own fixture is the counter-example:

```ts
// examples/next/content/kb.val.ts — SHOULD FAIL, currently passes
"kb-000": c.json(() => import("./kb/entry-000.val.json")),
//                            canonical: ./kb/kb-000.val.json
```

`examples/next/scripts/jsonvalues-fixtures.mjs:60` generates
`entry-${index}.val.json` for key `kb-${index}`, so all 120 entries are
non-canonical — in the app people read to learn what a Val project looks like.
`val validate --root examples/next` reports it as valid.

### Why it matters beyond tidiness

1. **A rename or a delete can orphan or clobber.** `getNewJsonEntryPaths` derives
   the path from the key, so renaming a key writes to the derived path — which, for
   a non-canonical entry, is NOT the file the old key was reading. The old file is
   left behind and the new key reads a file that was never written.
2. **It blocks the optimisation this item started as.** `markJsonEntriesStale`
   drops a module's ENTIRE loaded content because `jsonEntriesSha` cannot say which
   entry changed. With the mapping guaranteed, a changed file localises to exactly
   one key with no server round trip and no extra metadata: 1 refetch instead of 120. Today the guarantee does not hold, so the derivation cannot be trusted.
3. **It is a silent divergence between read and write.** Reads follow the thunk;
   writes follow the derivation. They agree only by luck.

### What to do

- [ ] **Validate it.** `validateJsonValuesEntries` should compare each entry's
      import target against `getNewJsonEntryPaths(module, key)` and report a
      mismatch. The target is available server-side without guessing: the module's
      `.val.ts` is parsed already (`ValSourceFileHandler`), so the import
      specifier is readable from the AST rather than from `thunk.toString()`.
      A `jsonValues:rename-entry-file` fix could move the file and rewrite the
      import, exactly as `extract-entry` does.
- [ ] **Fix the fixture.** `jsonvalues-fixtures.mjs` should emit
      `kb-${index}.val.json`. Mechanical: the generator (3 places), the 120
      committed files, `kb.val.ts`'s import list, and one reference in
      `docs/plans/jsonValues-walkthrough.md`. Left for a decision because it
      renames 120 committed files and touches a manual walkthrough.
- [ ] **Then** make `markJsonEntriesStale` per entry, which is what the reviewer
      was actually reaching for.

Rejected alternatives, kept so they are not re-proposed: reading
`thunk.toString()` to recover the path works unbundled and breaks under any
bundler (it becomes a chunk id); and having `c.json` take the path explicitly
makes the author write it twice.

## 10. Smaller correctness questions 🟢

- [ ] **Nothing enforces "no binary data in a patch".** Files are uploaded
      directly from the client and the `file` op left in the patch carries only a
      SHA-256 — but the enforcement is one call to `splitPatchFileOps` on the
      client, and the server accepts base64 in a `file` op without complaint.
      `ValOps` only ever null-checks that value; the binary is read back from the
      uploaded file, so bytes left in a patch are dead weight that produce NO
      file, silently. `packages/server/src/patchFileUpload.test.ts` pins that.
      Decide whether the server should reject a `file` op whose value looks like
      a data URL — it is a two-line check and it converts a silent
      no-file into a loud 400.
- [x] **The prototype now has an upload path.** `UploadFile` is a seam on the
      patch store: add = upload then record, remove = record then delete, and a
      failed upload creates no patch and rolls back what landed (best effort,
      reporting `orphaned` when cleanup also fails). Omitting the seam makes a
      patch carrying files be REFUSED rather than silently stripped. See
      `fileUpload.test.ts` and the section in `architecture.md`.
- [ ] **Who sweeps orphaned files?** Rollback is best effort by design, so
      `orphaned` is a list someone has to act on. A server-side sweep of
      unreferenced patch files is the only real answer; until then the bytes leak.
- [x] **~~`.jsonValues()` is not handled at all.~~** Implemented. Entry content
      is fetched on demand and substituted where source lives, so fields,
      renders, validation and the search walk all see real content without
      knowing markers exist. The read IS the demand signal and the read WAITS
      (`get` triggers the fetch and awaits it); `peek` is the side-effect-free
      companion, because the moment a read can cause a fetch, anything that
      merely looks becomes a fetch storm. A failed fetch is an `error`, never
      `absent`. Search reports `partialModules` separately from `staleModules`,
      validation reports `jsonEntriesLoaded`. 12 specs in `jsonValues.test.ts`.
      What is left is not correctness but granularity — see item 9b.
- [x] **~~Global head wastes reads.~~** Fixed by the per-module `Revision`: a patch
      in module A no longer stales a module-B reader. Was: a patch in module B
      stale, so it re-asks and gets its unchanged value back. Correct, never
      wrong — but the volume is unmeasured. If it is high, a per-module revision
      alongside the global head fixes it.
- [x] **`source:patch-apply` no longer emits with everything empty.** It is not
      news, and every consumer would otherwise have to defend against it.
- [x] **A patch that targets an unloaded module is retained, not skipped.** It is
      recorded in that module's chain and applied by `receive()` — see item 7.
- [x] **`createPatch` stamps `createdAt`.** Every local edit was falling back to
      the epoch and sorting below every other change in a review list documented
      as newest-first. The field stays optional on the type, for a record that
      genuinely has no timestamp; nothing the system creates is such a record.
- [ ] **A `failed` head is terminal.** A patch that cannot apply stays in the
      chain and the head stays `*-failed` forever. There is no recovery or
      skip-and-continue path.
- [ ] **`PatchSetStore.reset(modules)` throws** rather than resetting per module,
      because `PatchSets` has no per-module removal. Fine as an honest limit;
      needs closing before publish-per-module works.
