# Open questions — close these, or delete this file

> **Rule:** this file must be empty (and deleted) before the store prototype
> becomes anything more than an experiment. Every item below is a decision or a
> measurement that is currently missing, not a task that is merely unfinished —
> the unfinished-work list lives at the bottom of `architecture.md`.
>
> Items are ordered by how much other work they invalidate if answered the other
> way.

---

## 1. Nothing has been measured IN A BROWSER. This is the go/no-go. 🔴

**The question:** does per-path eventing + lazy compute actually beat the current
engine, in a browser, on a real project?

Every performance claim in `architecture.md` is **read off the code**. Not one
number came from a profile. The premise of the whole design — that a keystroke's
cost today is proportional to the project and can be made proportional to the
field — is plausible and specific, and still unverified.

This matters more than it sounds: `ValSyncEngine` already had four independent
fixes landed (Step 0 on this branch), and it is entirely possible those bought
most of the available win. If so, the correct decision is to stop here and keep
the engine.

Partly addressed, and worth being precise about how: work COUNTS are now
asserted in node (`activity.ts`, `activityCost.test.ts`) — one keystroke costs
one clone, one apply, one registry scan and exactly one woken field; a
40-keystroke burst costs zero renders and zero validations. That channel already
earned its keep by catching a demand-driven render fix that had put one
whole-module render back on every keystroke.

What it does NOT give is durations, bytes, or any comparison against the current
engine. A count is exactly reproducible in node; a duration is not.

- [ ] Build the bench harness (a `StringField` burst against a `handboka`-shaped
      407 KB fixture) and record: commits/keystroke, deepClone bytes, validation
      calls, render calls — for the engine, and for this.
- [ ] Decide go/no-go on that number, not on the design.

**Recommendation:** answer this before item 3 or 5. They are both expensive and
both pointless if the answer here is no.

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

## 5. The worker seam is designed but not wired. 🟡

**The question:** do we actually put search / patch sets / schema validation on a
thread, and does that pay?

Both realms currently run in one thread. The seams exist and are honest —
worker-realm stores hold no store references and take snapshots as arguments, so
they _cannot_ accidentally read across — but nothing has been connected to
`postMessage`.

Blocked on item 1: whether the thread hop pays for the structured clone is a
measurement, not an argument.

- [ ] Measure, then wire or delete the seam. A seam that is never crossed is
      indirection with a comment attached.

---

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
- [ ] **`.jsonValues()` is not handled at all** — now pinned by
      `jsonValues.test.ts`, 4 failing specs against 5 guards. What the guards
      establish: the record's KEY SET resolves while its entries are markers, so
      load state cannot be per module. What the specs show, live:
      a read inside an unloaded entry answers `absent` where the field does exist
      and its content simply has not arrived — so a field renders "not found" and
      stops asking, and the entry never loads; search returns
      `{results: [], staleModules: []}`, indistinguishable from "nothing
      matched", against a module the walk skipped by construction; validation
      returns `errors: false, customValidateStatus: "not-needed"` for a module
      whose content was never seen. **Blocked on the decision below**, because
      where entry content lives determines whether loading it moves the head. (see the hypothesis in
      `architecture.md`). The prototype has no marker substitution, so a project
      using `.jsonValues()` would read paths inside unloaded entries as `absent`
      — the precise confusion invariant 3 exists to prevent. Decide whether an
      entry load bumps the head or carries its own revision.
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
