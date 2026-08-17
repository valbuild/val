# Independent publish: staging and unstaging patches

Status: **design agreed, implementation in progress.** This document is the plan for
the branch it lives on; the implementation lands on the same branch, in the phases set
out in §10. The plan commit is deliberately first so the model and the
invariant in §4 can be reviewed before any code depends on them. Keep this document
updated as the implementation diverges from it — it is the reference the
content.val.build side is built against.

The goal: let two people work in the same Val project at the same time and let each
of them publish their own small change (say, just a title) without first merging or
publishing the other person's work.

The mechanism: a **patch group** — a per-user, uuid-identified set of patch ids.
Publishing publishes the group, not "everything pending". Patches that are not in
your group are **unstaged**: they exist on the server, they are part of the patch
chain, but they are not applied to what you see and they are not published when
you publish.

---

## 1. What a patch set is (please verify this)

This is my understanding of the existing `PatchSets` class
(`packages/ui/spa/utils/PatchSets.ts`). The whole design below leans on it, so
this section is here for you to check before anything else.

**Definition.** A patch set is a set of patches that are _not_ independent of each
other, so they must be discarded — and now, published — as a unit. It is
identified by a **patch set path**: `<moduleFilePath>?<jsonPatchPath joined by "/">`,
e.g. `/content/projects.val.ts?ProjectA/title`. When the affected path is empty the
key is just the module file path.

**How membership is decided** (`insert` → `insertPath`):

- `replace` → the patch set path is the op path itself. Two replaces on
  `ProjectA/title` and `ProjectA/description` are therefore two _separate_ patch
  sets, publishable independently.
- `add` / `remove` / `move` / `copy` → the code looks at the schema type of the
  **parent** of the op path:
  - **array** → the patch set is the whole array path. Rationale in the code: array
    ops shift indices, so every patch touching that array is interdependent and
    doing better would need "a lot of logic".
  - **record** → the patch set is the op path itself (the specific record key), which
    is more precise, because record keys are stable.
  - **image / file** → falls through to the parent path.
  - anything else → throws ("Cannot perform op ... on non-array or non-record
    schema").
  - `move` inserts **twice** — once for the destination parent and once for
    `op.from`'s parent. So one patch can belong to two patch sets.
- `file` and `test` ops → skipped entirely (a `file` op is carried alongside a
  `replace`/`add` in the same patch, and that op is what places the patch).
- No schema, or any thrown error while resolving the path (schema drift, etc.) →
  fall back to the **whole module file** as one patch set. Conservative: everything
  in that file becomes one unit.

**Nesting and merging** (the part that matters most for this feature). On insert,
the new key is compared against every existing key by string prefix:

- new key is _inside_ an existing key → the new patch joins the **existing**
  (broader) set.
- an existing key is _inside_ the new key → those existing sets are **merged into**
  the new, broader set and their old keys are deleted.

So patch sets **grow and coalesce over time**. A set that today is
`?items/0/title` can tomorrow become `?items` because someone did an array
insert. This is the single most important property for this feature — see §4.1.

**Ordering.** `orderedInsertKeys` and `patches[]` are both **newest first**; a
touched set is moved back to the head. `serialize()` returns
`PatchSetMetadata[]` in that order, and the compare view renders it directly.

**Scope.** It is computed **client-side**, in a web worker
(`packages/ui/spa/patchsets/patchsets.worker.ts`), from the patch ops plus the
`SerializedSchema` for the module. The home repo (content.val.build) has no part
in it today.

### Two bugs in that code the test rig should catch

I found these while reading; they are not blockers but they become correctness
bugs once patch sets decide _what gets published_, so they belong in this
feature's scope.

1. **Prefix matching has no segment boundary.** `insertPath` uses raw
   `String.startsWith` on the composed key. The comment argues this is safe because
   `.val.ts` terminates the file part and `?` delimits the patch path — true at the
   _file_ level, false at the _segment_ level. `…?items/foobar` starts with
   `…?items/foo`, so a patch on record key `foobar` gets merged into the patch set
   for record key `foo`. Effect today: two independent changes are shown and
   discarded as one. Effect after this feature: staging `foo` silently drags
   `foobar` into your publish.
2. **`insertedPatches` is not updated on the no-schema path.** `insert` returns
   early in the `if (!schema)` branch _before_ `this.insertedPatches.add(patchId)`.
   So a patch with no schema is inserted every time it is seen and is never
   reported by `isInserted`/`getInsertedPatches`. It also means the `op.op === "file"`
   early-return happens _after_ the add, which is correct, but the asymmetry is
   accidental.

---

## 2. Staged is the truth

**Settled.** The staged set is what the user's world looks like. Concretely, for a
given user, `base + their patch group` is the content shown:

- everywhere in the studio — field values, lists, media;
- in the preview (draft mode) of the running site;
- and it is exactly what publish writes.

**The one exception is the compare view**, which by definition has to show more than
the current truth: `base → staged` as the diff, plus the unstaged patches as
separately-listed rows you can stage.

Everything below follows from this, so the consequences are worth spelling out.

### 2.1 It is cheaper than it looks

The preview needs no separate plumbing. `ValNextProvider` renders draft content
**browser-side** from the same store the studio reads ("draft data is browser-only"),
so once `ValSyncEngine` applies only the group's patches to its optimistic source,
studio and preview are staged-correct together. The server-side path needs exactly one
change: a `patch_group_id` on `PUT /sources/~?apply_patches=true` (§6.2), so the
server-applied source agrees with the client's.

### 2.2 Patches outlive commits, and the prefix invariant is what makes that safe

Publish must not disturb anyone else's pending work: Alice publishes, and Bob keeps
working on patches that were already there. Patches living past a commit is the existing
design — `applicable/patches` is asked what applies on top of a given commit, and
committed patches are marked `applied` rather than deleted — and this feature must not
weaken it.

It doesn't, and the reason is worth writing down, because it is the argument that the
whole design rests on.

A patch's op paths are computed against `base + the author's group at the time`. So the
worry is: Alice publishes an array insert; Bob's pending `replace items/1/title` was
written when that insert wasn't in Bob's view; after the commit it now points at a
different element.

**The closure rules that out.** Bob's `items/1/title` and Alice's `add items/0` are in
the same patch set — `?items/1/title` is inside `?items`, so they coalesce. Which means
that when Bob made his edit, the prefix invariant forced Alice's patch into Bob's group
(§2.3). Bob computed `items/1` _with_ Alice's insert applied. After Alice publishes,
that insert is in the base, and Bob's index still means what he meant.

Generalised:

> If two patches are in the same patch set, the later one's author necessarily had the
> earlier one staged. So a patch's paths are always valid in any order that includes its
> patch-set predecessors — which is exactly what publishing a prefix-closed group, and
> then committing it into the base, produces.

And if two patches are in _different_ patch sets, they are independent by definition —
that is what a patch set means — so a commit of one cannot move the other.

So there is **no base-relative validity condition** and no `base_commit` to check. A
group is a set of ids that can be applied on top of whatever commit is current. Publish
does not need permission from the other groups, and the other groups need no rebase:
their patches keep applying, and their authors keep working.

Two honest residuals, neither of which needs new machinery:

- The argument is only as good as the patch sets. If a patch set is too _narrow_ — as it
  is today with the segment-boundary bug in §1 — two genuinely interdependent patches
  land in different sets, the closure never links them, and the guarantee above does not
  hold. That is why fixing that bug is block A and not a footnote, and why the rig
  asserts non-interference (§7, invariant 4) rather than trusting the grouping.
- `markApplied` is still required, but for a plainer reason than I first wrote: once
  Alice's commit lands, patches she published must be reported as `applied` so nobody
  re-applies them and so they leave the other groups. `analyzePatches` already skips
  patches with `appliedAt` set, so the missing half is the marking (§9).

### 2.3 You cannot leave someone else's array edit unstaged

If Bob has an unstaged patch on `items` and Alice edits that same array, the array
patch set contains Bob's patch, so the closure (§4) pulls it into Alice's group. Alice
_cannot_ make that edit while leaving Bob's out — the prefix invariant forbids it.

This is correct (her indices were computed against a state that includes his change,
or rather: they are only meaningful in an order that includes it), but it is a
surprise, and the UI must say so at the moment of staging rather than quietly
enlarging the group. Scalar `replace` on a different field has no such interaction —
that is the case the whole feature exists to serve.

By the same mechanism, **unstaging is not durable against your own later edits** in the
same patch set: unstage Bob's array change, then edit that array yourself, and the
closure pulls it back. Also worth a UI note.

### 2.4 Divergent views are accepted

Two users looking at the same URL will see different content, and that is the intended
behaviour, not a defect to design around. Two knock-ons:

- Screenshots and bug reports become per-user. Anything that reports "what the site
  looks like" needs to say whose view it is.
- **`stat` cannot detect a group-membership change.** `getStat` derives its `patches`
  array from `fetchPatches`, i.e. from `applicable/patches`, and the client compares
  patch **ids**. Staging or unstaging changes no ids, so a change made in another tab —
  or a §4.1 repair computed by another client — would never invalidate. `stat` needs a
  `patchGroupsSha` (a hash over the caller's group membership) alongside the existing
  shas, and `syncWithUpdatedStat` needs to treat a change in it as a source-invalidating
  event. Note `sourcesSha` is computed by `extractValModules` from the _unpatched_
  modules, so it is unaffected and cannot be reused for this.

### 2.5 Naming

**Settled: patch group.** Not to be confused with **patch set**, and the distinction is
load-bearing throughout this document:

- a **patch set** is _computed_ — the patches that must move together, derived from the
  schema (§1);
- a **patch group** is _curated_ — the patches this user has chosen to publish.

---

## 3. Model

```
patch_group
  id                 uuid  (primary key)
  project            text
  branch             text
  author_id          text
  created_at         timestamptz
  published_at       timestamptz  null
  published_commit   text         null

patch_group_patch          -- many-to-many, deliberately
  patch_group_id     uuid
  patch_id           uuid
  added_at           timestamptz
  added_reason       enum('explicit','dependency')
  primary key (patch_group_id, patch_id)
```

Notes on the shape:

- **Many-to-many is required, not a convenience.** The prefix invariant (§4) means one
  patch can end up in several users' groups: if Alice edits an array that Bob already
  edited, Bob's patch is pulled into Alice's group while staying in Bob's.
- **"Current group" per user** = the newest non-published `patch_group` for
  `(project, branch, author_id)`. Create lazily on first patch. One per user for now;
  the schema already allows more.
- **No base-commit column.** Per §2.2 a group is applicable on top of whatever commit is
  current; there is no base-relative validity condition to record or check.
- A patch in **no** group is unstaged. It still exists, still occupies its place in
  the patch chain, and is still returned by `applicable/patches`.
- `added_reason` is for UI only ("this was added because your change depends on
  it"), but it is what makes the auto-repair in §4.1 and the forced staging in §2.3
  explainable instead of magic.

---

## 4. The invariant

Everything about "when must a patch be added to a group" reduces to one rule.

> **Prefix invariant.** For every patch group `G` and every patch set `PS`,
> `G ∩ PS` must be a **prefix** of `PS` in patch-chain order.

Chain order = the order `applicable/patches` returns, which is the order
`prepare()` applies patches in.

Why a prefix and not just "any subset with its dependencies": within a patch set the
patches are, by construction, mutually dependent in chain order. If `PS = [p1, p2, p3]`
and `G` contains `p1` and `p3` but not `p2`, then `p3`'s array indices were computed
against a state where `p2` had been applied. Skipping `p2` either errors or silently
writes to the wrong index. A prefix is the only shape that is always safe.

This gives both operations for free, and it is exactly the asymmetry you described:

- **Stage `p`** (at index `i` in `PS`) → also add `PS[0..i]`. These are the patches
  that already existed in that patch set when you touched it. "_If a user adds a
  change to a patch set we need to add all the patches in that patch set to the same
  group._"
- **Unstage `p`** (at index `i`) → also remove `G ∩ PS[i..n]`. Removing forward, not
  backward.
- **Someone else appends to the patch set afterwards** → nothing happens to your
  group. Their patch is _after_ yours; your prefix is untouched and still applies.
  "_If another user adds on top of the list of patches in a patch set we do not need
  to add those patches._" Their staging will pull your patches into _their_ group,
  not the other way round.

Because a patch can belong to two patch sets (`move`), the closure is transitive:
pull in the prefix, then re-check every patch set that those newly-added patches
belong to, until fixpoint.

### 4.1 The hard case: patch sets merge retroactively

This is the case I'd most want the rig to hammer, because it can break a group that
was valid when it was created and nobody has touched since.

Patch sets coalesce (§1, "Nesting and merging"). Consider:

```
t0  p1  replace /content/page.val.ts  items/0/title      (Bob)
t1  p2  replace /content/page.val.ts  items/1/title      (Alice)

    patch sets: A = [p1] @ ?items/0/title
                B = [p2] @ ?items/1/title
    Alice's group G = {p2}            -> G ∩ B = [p2], a prefix. Valid.

t2  p3  add     /content/page.val.ts  items/2            (Carol, array insert)

    the array op broadens the key to ?items, which is a prefix of both A and B,
    so A and B merge:  PS = [p1, p2, p3]
    Alice's group G = {p2}            -> G ∩ PS = [p2]. NOT a prefix. Broken.
```

Nobody edited Alice's group. A third party's unrelated patch invalidated it. So:

- The invariant must be **re-validated on every patch-set recomputation**, not only
  on stage/unstage.
- There must be a **repair** step, and it has to pick a side:
  - **Extend** (add `p1` to Alice's group) — Alice's change stays publishable, but she
    now publishes Bob's patch, which she never chose.
  - **Truncate** (drop `p2` from Alice's group) — nothing unexpected gets published,
    but Alice's own work silently leaves her group and her next publish is a no-op.

  **Recommendation: extend, and make it visible.** Silently dropping a user's own
  change is the worse failure — they hit Publish, get success, and their edit isn't
  live. Extending is surfaceable: the compare view shows the pulled-in row with
  `added_reason = 'dependency'` and a "required by your change" note, and the user can
  still unstage their own change (which, by the unstage rule, drops the whole tail
  and returns to a clean state).

- Repair runs **client-side** at the same moment patch sets are recomputed, and the
  resulting adds are pushed to the home repo. It must be **idempotent** — several
  clients will compute the same repair concurrently, and `patch_group_patch` upserts
  make that harmless.

---

## 5. Where the closure is computed

**Client-side, in this repo.** The closure needs patch sets, patch sets need
`SerializedSchema` and `schemaTypesOfPath`, and the home repo does not evaluate
schemas — it stores patches, commits and shas. Shipping the schema to
content.val.build just to compute this would be a much bigger change and would
duplicate the algorithm in two languages.

So: the client computes the set of patch ids that must accompany a new patch and
**sends them with the create-patch call**. The home repo does a set-union into the
group. This matches your instinct — "_when we create a patch it should be possible
to add a set of patch ids also to the same patch group_" — and gets the property you
asked for: there is no window in which a patch exists but is not in a group.

**The trust boundary this creates, stated plainly:** an old or buggy client can send
a wrong closure, and the home repo cannot tell. Mitigations, in order of cost:

1. The home repo stores an **algorithm version** on `patch_group_patch`
   (`closure_version`), so a bad rollout is identifiable and re-computable later.
2. The home repo enforces the one invariant it _can_ check without schemas: a group
   may not contain a patch whose `parentPatchId` chain position is unknown to it,
   and publish of a group is rejected if `prepare()` errors (this already happens —
   `/save` returns 400 on `preparedCommit.hasErrors`).
3. Belt-and-braces fallback, if we ever want it: a home-repo-side coarse closure of
   "same module file path ⇒ same group". Correct but so coarse it defeats the
   feature. Not recommended; listed so it is on the record as the escape hatch.

---

## 6. API surface

### 6.1 This repo → home repo (content.val.build)

Existing calls, in `packages/server/src/ValOpsHttp.ts`:

| Call                                                            | Change                                                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/{project}/patches` (`saveSourceFilePatch`)            | **Add** `patchGroupId: string \| null` and `alsoAddPatchIds: string[]` to the body. `null` group id = "my current group, create it if absent"; the response returns the id used. `alsoAddPatchIds` is the closure prefix. The whole thing is one transaction: patch row + group membership for the patch + membership for the closure.                                     |
| `GET /v1/{project}/applicable/patches` (`fetchPatchesInternal`) | **Additive only** — see §6.3. Each patch gains `patchGroupIds: string[]`. Response gains top-level `patchGroups: [{ id, authorId, createdAt, publishedAt }]`. Existing fields unchanged.                                                                                                                                                                                   |
| `POST /v1/{project}/commit` (`commit`)                          | Already takes a prepared commit built from a patch id subset, so no signature change. It must additionally mark the group published, mark the committed patches applied so `applied.commitSha` is set for exactly those, and **remove the published patch ids from every other group** that contains them (they are applied now). No base-commit pre-condition — see §2.2. |
| `DELETE /v1/{project}/patches`                                  | Deleting a patch must cascade-delete its `patch_group_patch` rows, and must apply the unstage rule to every group it was in (drop the tail of the patch set within each group).                                                                                                                                                                                            |

New calls:

| Call                                                  | Purpose                                                                                                                                             |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/{project}/patch-groups/{groupId}/patches`   | Stage. Body `{ patchIds: string[] }`, the already-closed set. Idempotent upsert.                                                                    |
| `DELETE /v1/{project}/patch-groups/{groupId}/patches` | Unstage. Body `{ patchIds: string[] }`, the already-closed (forward) set. Idempotent.                                                               |
| `GET /v1/{project}/patch-groups`                      | Read groups without fetching the whole patch chain — for the "other people have unstaged work" indicator. Optional; §6.3 makes it non-load-bearing. |

`POST /v1/{project}/patches/{patchId}/files` needs no change: a `file` op rides along
with the source op in the same patch, and group membership is per patch.

### 6.2 This repo's own routes (`packages/shared/src/internal/ApiRoutes.ts`)

- `PUT /patches` — body gains `patchGroupId: z.string().nullish()` and
  `alsoAddPatchIds: z.array(PatchId).optional()`; the 200 response gains
  `patchGroupId: z.string()`.
- `GET /patches` — each patch gains `patchGroupIds: z.array(z.string()).optional()`;
  response gains `patchGroups` (optional, so FS mode can omit it).
- **New** `PUT /patch-groups/~/patches` and `DELETE /patch-groups/~/patches`,
  mirroring §6.1.
- `POST /save` — **no change needed**. It already takes `patchIds: PatchId[]` and
  builds the commit from exactly those. Independent publish is, at the transport
  level, already possible; what is missing is the group that decides which ids to
  send. Worth calling out because it removes a whole milestone.
- `PUT /sources/~?apply_patches=true` — needs a way to say _which_ patches to apply.
  Add `patch_group_id` (or `staged_only`) so the server-rendered "applied" source
  matches the user's staged view rather than "everything pending".
- FS mode (`ValOpsFS`) has no groups. Simplest honest behaviour: FS mode reports a
  single implicit group containing every pending patch, so the UI code path is
  uniform and stage/unstage is disabled. Do **not** try to emulate multi-user
  staging on the filesystem.

### 6.3 Rollout: annotate, never filter

**`applicable/patches` must keep returning the full patch chain.** This is not a
style preference, it is a correctness constraint:

`ValSyncEngine.getParentRef()` computes the parent of a new patch as the **last**
patch id it knows about (`packages/ui/spa/ValSyncEngine.ts`). If the server filtered
the response down to one group, every client would compute a parent that is not the
real chain head, and `PUT /patches` would answer 409 `patch-head-conflict` forever.
Any filtering variant would have to add an explicit chain-head field and rework
`getParentRef` — real work, for no benefit.

So the endpoint stays a full listing and gains annotations. This is safe for old
clients because `GetApplicablePatches` in `ValOpsHttp.ts` is a plain (non-strict)
zod object, and zod **strips** unknown keys rather than failing — an old server
package deployed against a new home repo keeps working, ignoring the new fields.
It is also the only option that is **atomically consistent**: a separate
`/patch-groups` endpoint can return a group referencing a patch that the
concurrently-fetched patch list does not yet contain, and the client would have to
handle a dangling id.

Filtering then happens in exactly two places, both already patch-id-driven:

1. **Publish** — `/save` gets the group's patch ids instead of all pending ids.
2. **Rendering** — the sync engine applies only the group's patches to the optimistic
   source, and the compare view splits rows into staged / unstaged.

Rollout order, each step shippable on its own:

1. Home repo: tables + `patchGroupIds`/`patchGroups` annotations + write endpoints.
   No client reads them yet. Every patch auto-joins its author's current group, so
   groups are fully populated before any client depends on them.
2. This repo, behind a flag: parse the annotations, keep applying _all_ patches, and
   send the group's ids to `/save`. Behaviour identical to today as long as every
   patch is in the group — which step 1 guarantees. This is the risky step and it is
   observable without changing behaviour.
3. This repo: unstage becomes possible. Only now can a group be a strict subset, and
   only now does `apply_patches` need the group id.
4. UI in the compare view.

---

## 7. Testing rig

You asked for a rig that verifies the closure computation and catches issues. The
thing worth testing is **not** "does the closure function return this array" — it is
"does a staged subset actually apply, and does it produce what the compare view
promised". So the rig should _execute_ patches, not just compare metadata.

Location: `packages/ui/spa/utils/patchGroups.test.ts` plus a shared harness
next to the existing `PatchSets.test.ts` (whose style — build schemas with `s` from
`initVal`, feed literal patch streams — is the right base, per the repo's test rules).

### 7.1 Harness

```
scenario({
  schema,                        // built with s.* from initVal
  base,                          // initial source, type-checked via c.define
  patches: [ { patchId, author, createdAt, patch } ... ],   // chain order
  staged:  [ patchId ... ],      // what the user picked, pre-closure
})
```

The harness then:

1. Feeds every patch through `PatchSets.insert` in chain order → the patch sets.
2. Runs the closure over `staged` → `G`.
3. Applies **all** patches to `base` in chain order → `full`.
4. Applies **only `G`** in chain order → `stagedResult`.
5. Applies `G`, then the complement, in chain order → `rebasedResult`.
6. **Publish, then continue.** Takes `stagedResult` as a new base, marks `G` applied,
   drops it from every group, and applies each other author's remaining group to that new
   base → `survivorResults`. This simulates "Alice published, Bob keeps working" and is
   the step that actually tests the §2.2 argument. It is also where a _new_ patch is then
   created by another author against the new base, so the post-commit chain is exercised
   rather than only the pre-commit one.

### 7.2 Invariants asserted

| #   | Invariant                                                                                                                                                                                    | Catches                                                                                                                                                                                             |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Prefix** — for every patch set `PS`, `G ∩ PS` is a prefix of `PS`.                                                                                                                         | The core rule. Pure metadata check, cheap, run on every scenario.                                                                                                                                   |
| 2   | **Applicability** — step 4 never throws and never produces a patch error.                                                                                                                    | Array index-out-of-bounds from a hole in the middle of a patch set. The failure mode that today shows up as a failed commit.                                                                        |
| 3   | **Fidelity** — for every staged patch set path, the value at that path in `stagedResult` equals the value in `full`.                                                                         | The publish delivering something other than what the compare view showed.                                                                                                                           |
| 4   | **Non-interference** — for every _unstaged_ patch set path, the value in `stagedResult` equals the value in `base`.                                                                          | Staging one change leaking a neighbouring change. This is the assertion that fails on the `items/foo` vs `items/foobar` prefix bug (§1, bug 1).                                                     |
| 5   | **Convergence** — `rebasedResult` deep-equals `full`.                                                                                                                                        | Unstaged patches becoming unapplicable after someone else publishes.                                                                                                                                |
| 6   | **Minimality** — `G` equals exactly the union of the prefixes of the patch sets touched by `staged`; no extra ids.                                                                           | Over-broad closure quietly publishing other people's work. Guards against "fix it by pulling in the whole module".                                                                                  |
| 7   | **Idempotence** — closure(closure(S)) == closure(S); stage-then-unstage returns to the original `G`.                                                                                         | Concurrent clients computing repairs (§4.1).                                                                                                                                                        |
| 8   | **Merge repair** — after inserting a patch that coalesces two patch sets, re-running validation restores invariant 1, and under the "extend" policy `G` only grows.                          | §4.1, the retroactive-invalidation case.                                                                                                                                                            |
| 9   | **Staged is the truth** — `stagedResult` deep-equals the group-scoped source the studio and preview rendered for that author.                                                                | The studio and the publish disagreeing. This is §2 stated as an assertion, and the reason the harness applies patches rather than inspecting metadata.                                              |
| 10  | **Publish then continue** — every group in `survivorResults` still applies cleanly to the new base, and the value at each of its patch set paths is what that author saw before the publish. | The §2.2 argument being wrong. A patch of Bob's silently landing on a different array element after Alice published is precisely what must never happen, and it is not decidable from the metadata. |

### 7.3 Generative layer

Invariants 1–10 are all decidable from the scenario, so they can be driven by a
seeded generator rather than only hand-written cases:

- random schemas over `object` / `array` / `record` / `string` / `number` / `image`,
  bounded depth;
- random op streams (weighted towards array `add`/`remove`/`move`, which is where the
  interdependence lives) from 2–3 authors;
- random staged subsets;
- shrink on failure to the smallest reproducing scenario, and print it as a
  paste-able hand-written test.

Seeded and deterministic — no `Math.random()` without a fixed seed, so CI failures
reproduce.

Hand-written scenarios to include regardless, because they are the ones that will
actually regress: the §4.1 merge case; `move` between two arrays (one patch, two
patch sets); a `remove` of a record key that another staged patch writes into; a
`file`-op patch whose source op is staged; a patch with no schema (whole-module
fallback); and the `foo` / `foobar` sibling-key case.

---

## 8. UI

The compare view (`packages/ui/spa/components/ComparePatchSets.tsx`) is the right
home, as you said — it already renders one row per patch set, and one row per patch
set is exactly one stage/unstage unit.

- Each patch-set row gets a checkbox / toggle. Toggling calls stage or unstage with
  the closed set, so a single click can move several rows.
- Rows split into **Staged** (will publish) and **Unstaged** (exists, will not
  publish, not reflected in your preview). Unstaged must stay visible and
  re-stageable — otherwise unstaging is a one-way trapdoor.
- When staging pulls in extra rows, show them with the "required by your change"
  note from `added_reason`, and show the author. This is where the §4.1 extend
  policy stops feeling like magic.
- **Confirm before enlarging the group across authors.** Per §2.3, editing an array
  someone else has unstaged work on forces their patch into your group. Say so at the
  moment of staging — "publishing this also publishes Bob's change to Items" — rather
  than letting the group grow silently.
- **Unstage is not sticky.** Also per §2.3, unstaging a patch set you then edit pulls
  it back. Worth a line on the unstaged row so the user isn't surprised twice.
- Publish sends only the staged ids. `DraftChanges` needs the same split so the
  pending-changes count isn't misleading.
- Since staged is the truth (§2), the studio outside the compare view needs no
  staged/unstaged affordance at all — it simply renders the group. The only visible
  hint that unstaged work exists belongs in the compare view and the pending count.
- FS mode: hide the whole affordance (single implicit group).

---

## 9. Settled, and still open

### Settled

- **Staged is the truth** — studio, preview and publish all show `base + your group`;
  only the compare view shows more. §2, with its consequences.
- **Patches outlive commits; groups are not base-relative.** Alice publishes, Bob keeps
  working, and Bob's patches keep applying — guaranteed by the prefix invariant rather
  than by a rebase. §2.2 has the argument. No `base_commit`, no revalidation step.
- **`markApplied` gets implemented.** Required, but for the plain reason: published
  patches must be reported `applied` so nobody re-applies them and so they leave the
  other groups. `analyzePatches` already skips patches with `appliedAt` set, so the
  missing half is the marking — the `// TODO:` in `ValServer.ts` (~line 1886). Block C.
- **Naming: patch group.** §2.5.

### Still open

1. **Publishing someone else's patch.** The prefix rule means Alice's publish can
   include Bob's patch (§2.3). Should Bob be told? At minimum his group must show the
   patch as published rather than silently vanishing.
2. **Empty publish.** After a truncating repair a group can become empty. Publish
   should refuse with a clear message rather than committing nothing.
3. **Multiple groups per user.** The schema allows it; the UI does not. Worth
   confirming that "one open group per user per branch" is the intended constraint
   for v1, since it decides whether the group id needs to appear in URLs.

---

## 10. Implementation checklist for this branch

Ordered so that each block is reviewable on its own and nothing depends on
content.val.build until block C. Blocks A and B are shippable before the home repo
has any patch-group support at all.

**A. Closure + test rig (no API, no behaviour change).**

- [ ] Fix the two `PatchSets.insertPath` bugs from §1 — segment-aware prefix
      matching, and `insertedPatches.add` on the no-schema path. Add the failing
      cases to `PatchSets.test.ts` first.
- [ ] `stageClosure(patchSets, patchIds)` and `unstageClosure(patchSets, patchIds)`
      in `packages/ui/spa/utils/patchGroups.ts`, plus `validateGroup` /
      `repairGroup` for §4.1. Export a `CLOSURE_VERSION` constant.
- [ ] The harness and invariants 1–10 from §7 in
      `packages/ui/spa/utils/patchGroups.test.ts`.
- [ ] The seeded generative layer from §7.3, with shrinking.

**B. Client plumbing behind a flag (still no behaviour change).**

- [ ] Track group membership in `ValSyncEngine`; parse the annotations from §6.2 and
      tolerate their absence (FS mode, old home repo).
- [ ] Send `patchGroupId` + `alsoAddPatchIds` on `PUT /patches`; add the fields to
      `ApiRoutes.ts` and thread them through `ValOpsHttp.saveSourceFilePatch`.
- [ ] Send the group's ids to `/save` instead of all pending ids. Identical
      behaviour while every patch is in the group.
- [ ] `ValOpsFS`: single implicit group containing every pending patch.

**C. Strict subsets — "staged is the truth" (first real behaviour change; needs the
home repo).**

- [ ] Stage/unstage routes (§6.2) and the `ValOpsHttp` calls behind them.
- [ ] Apply only the group's patches to the optimistic source in `ValSyncEngine`. This
      is the change that makes the studio _and_ the browser-rendered preview staged
      (§2.1) — one change, both surfaces.
- [ ] `patch_group_id` on `PUT /sources/~?apply_patches=true`, so the server-applied
      source agrees with the client's.
- [ ] `patchGroupsSha` in the `stat` response, and treat a change in it as
      source-invalidating in `syncWithUpdatedStat` — otherwise stage/unstage in one tab
      never reaches another, and §4.1 repairs don't propagate (§2.4).
- [ ] Implement `markApplied` (`ValServer.ts` ~line 1886), so published patches are
      reported `applied` and leave the other groups instead of being re-applied (§2.2).

**D. UI.**

- [ ] Staged / unstaged split and per-row toggles in `ComparePatchSets` (§8).
- [ ] "Required by your change" attribution from `added_reason`.
- [ ] Cross-author confirm before staging enlarges the group (§2.3).
- [ ] `DraftChanges` count reflects the staged set.

Before marking this ready: `pnpm run lint`, `pnpm -w run format`,
`pnpm run -r typecheck`, `pnpm test`, `pnpm run build`, and
`cd examples/next && pnpm run build` — per the CI list in `.agent/rules.md`.
