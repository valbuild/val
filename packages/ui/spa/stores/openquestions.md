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

## 2. A field is woken by its own edit. 🔴

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

## 3. Renders are not path-scoped, and fixing that means changing `packages/core`. 🔴 STILL OPEN — now with a number

**The question:** do we add a core entry point that renders ONE path, or accept
whole-module renders?

`RenderStore.get(path)` is per-path, but `executeRender` takes a whole module, so
one request still walks everything. For `handboka` — `select` at two nested array
levels — that is every chapter and every section on any change to the module.

What the store bought: lazy instead of eager, cached, and de-duplicated across
concurrent readers. So the cost moved from **per keystroke** to **per
change-then-read**. Real, but it is not the fix.

What the fix needs: a way to evaluate `render` for a single `SourcePath` without
walking siblings. That is a change to schema internals in `packages/core`, and it
is the thing that would make renders affordable on the worst case.

Now measured rather than argued: one listener on one row of a three-row list
costs **3** `select` invocations to serve **1**. The test is
`demandDriven.test.ts` → "runs select only for the path being listened to",
marked `it.failing`, so it will fail loudly the day this is fixed.

Note what the fix actually is, because it is more than a parameter:
`ArraySchema`'s list render is `src.map(select)` — the payload IS the whole list
— so scoping it means making a list render **windowed**, across the ~16 schema
classes that implement `executeRender`.

- [ ] Decide whether this experiment is allowed to change `packages/core`.
- [ ] If not: say so, and accept that the `handboka` render cost is unaddressed —
      and re-examine whether item 1's numbers still justify the rewrite.

---

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

- [ ] **Global head wastes reads.** A patch in module A makes a reader in module B
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
