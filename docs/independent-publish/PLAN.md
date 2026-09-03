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

### Two bugs in that code

Both are harmless-ish today and become correctness bugs once patch sets decide
_what gets published_, so they are in this feature's scope.

1. **Prefix matching had no segment boundary — FIXED.** `insertPath` used raw
   `String.startsWith` on the composed key. The comment argued this is safe because
   `.val.ts` terminates the file part and `?` delimits the patch path — true at the
   _file_ level, false at the _segment_ level, since nothing terminates a path
   segment. `…?foobar/title` starts with `…?foo`, so removing record key `foo` and
   retitling record key `foobar` were merged into one patch set. Effect before this
   feature: two independent changes shown and discarded as one. Effect after:
   staging `foobar` silently publishes the deletion of `foo`.

   Replaced with `isInsidePatchSetPath`, which checks the boundary character — `?`
   when the outer key is a bare module file path, `/` when it already has a patch
   path. The scenario suite (§7) caught this on its first run, via the
   `independent` declaration, and now covers it.

2. **`insertedPatches` bookkeeping is wrong for multi-op patches.** Worse than it
   first looked, because `insert` is called **once per op**, not once per patch —
   see `PatchSetStore.insertRecords` (`packages/ui/spa/stores/PatchSetStore.ts`),
   which is now the only production caller. Given that:
   - `this.insertedPatches.add(patchId)` sits _before_ the
     `if (op.op === "file" || op.op === "test") return;` line, so a patch whose
     **first** op is a `file` op marks the whole patch inserted and then hits the
     `has(patchId)` guard on every later op — its source ops are silently dropped
     and the patch never lands in any patch set. It does not bite today only
     because `createFilePatch` and `ModuleGallery` both emit the source op first.
   - The `if (!schema)` branch returns _before_ the add, so a no-schema patch is
     re-inserted every time it is seen and is never reported by
     `isInserted`/`getInsertedPatches`.

   The clean fix is to make `insert` take the whole patch (`Operation[]`) and do
   the per-op loop internally, so patch-level dedupe is actually patch-level.
   That changes the method's signature and four call sites, so it is called out
   rather than done silently — see §10 block A.

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
so once `SourceStore` applies only the group's patches to the source it serves,
studio and preview are staged-correct together. The server-side path needs exactly one
change: a `patch_group_id` on `PUT /sources/~?apply_patches=true` (§6.2), so the
server-applied source agrees with the client's.

### 2.2 A group holds its owner's patches, closed over their patch sets

The danger this rule has to answer is real, and it is worth stating before the rule.
The scenario suite has it as an executable test (`patchGroups.test.ts`, "a path is
picked before the closure runs").

The closure runs when a patch is **created** — which is after its author has already
picked a path. Suppose Alice has inserted at `items/0` and that insert is not in Bob's
group. Bob sees `[A, B, C]`, picks index 1 meaning "B", and if his patch then applies
without her insert, index 1 is "A" and he has silently renamed the wrong element. It
applies cleanly, the prefix invariant holds, nothing is detectably wrong except the
content. **Staging later cannot fix a path chosen earlier.**

An earlier revision of this document concluded from that counterexample that every
group must hold every pending patch. That was over-broad. What the danger actually
requires is that a group hold every pending patch that could **shift its own paths** —
and "the patches that can shift each other's paths" is the definition of a patch set
(§1). Alice's insert and Bob's rename both touch `?items`, so they are one patch set
and `stageClosure` pulls her insert in when his patch is created. Bob is protected by
the closure, not by a blanket.

So the rule is: **a new patch joins its own author's group, together with whatever the
prefix invariant drags along inside its patch sets. It joins nobody else's group, and
it does not pull in patches from other patch sets.** `DEFAULT_GROUP_IS_EVERYTHING` in
`packages/ui/spa/utils/patchGroups.ts` is the flag that records this, and its doc block
is the canonical statement of the argument.

Where a blanket and the closure differ is patches in **different** patch sets: Alice
edits `?title` while Bob edits `?items`. Bob's group excludes her title change, and
that cannot corrupt his op, because a different patch set means nothing that shifts his
paths. What it does mean is that Bob's view is `base + his own + whatever the closure
pulled in` — he does not see her title change until it is published. Divergent views
are accepted (§2.4); this is where they come from.

Two consequences, both deliberate:

- **Publish is not what it was before patch groups.** It ships your own work and what
  is entangled with it, not everything pending. That is the feature, but it does mean
  the first Publish after this ships can be a smaller set than the same click would
  have published yesterday.
- **Patch sets coalesce retroactively.** `PatchSets.insertPath` merges an existing set
  into a broader one, so a group that was prefix-closed can stop being so through
  nobody's action. `repairGroup` with the `extend` policy is what keeps it applicable;
  `PatchStagingProvider` runs it on every recomputation of the index rather than only
  on stage/unstage.

### 2.3 Independence comes from unstaging, and a held region is read-only

Excluding other patch sets is half of the independence; the other half is an explicit
act: **unstage**. Carve a patch set out of your own group and it leaves your view and
your publish, while still existing for everybody else. The headline scenario is Alice
shipping a one-line title fix while Bob's half-finished list stays behind, then Bob
finishing and shipping the list against the new base.

But the §2.2 hole is still reachable deliberately: unstage a patch, then edit the
region you just carved out. Your view no longer has that patch, so you pick a path
against it, and the closure re-stages it and shifts everything under you. Base
`[A, B, C]`, Bob inserts `Draft` at the top, Alice unstages it, Alice renames index 1
meaning "B" — and gets `[Draft, B*, B, C]`. She renamed "A".

The guard is `editWouldRestage`, and it distinguishes two cases that look alike:

- **A region you deliberately held back** — you unstaged it — is **read-only until you
  stage it again.** The edit is refused and you are asked to re-stage, which updates
  your view; only then can you pick a path that means what you think it means.
- **A region you simply never had** — another author's patch set that has always been
  outside your group — is **auto-staged first**, and your op is then resolved against
  the updated view before it is taken. You are not refused for a decision you never
  made; you just end up holding their patch set, because holding it is what makes your
  path mean what you saw.

Refusing an edit is annoying. Corrupting one silently is worse. Auto-staging where
there was no declaration to respect keeps the annoyance to the cases where you asked
for it.

Being precise about "region" matters in both directions. The guard mirrors
`PatchSets.insert`: it keys a `replace` on the op path alone, and only adds the parent
for ops that can widen to it. Widening a `replace` would make a top-level field key the
whole module, which contains every patch set — so holding one region would block every
edit and unstaging would be pointless. There is a unit test for exactly that.

Two things follow that the UI has to carry:

- Held rows stay **visible and re-stageable**. If unstaging hid the change, unstaging
  would be a one-way trapdoor with no way back.
- Toggling a row can move more than that row, because a patch set is the unit that must
  move together. The tooltip names what else moves and whose it is.

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
  `added_reason = 'dependency'` and a "required by your change" note.

  Two things the scenario suite settles about this choice (compare the `extend` and
  `truncate` traces under "DECISION 2" in `patchGroups.test.ts`):
  - **`extend` is safe here, unlike the unstage case in §2.3.** A merge is always
    caused by a _broader_ new path, and the patches `extend` pulls in are the ones
    _before_ the victim's patch — which had _narrower_ paths, i.e. leaf replaces or
    specific record keys. Those do not shift indices, so the victim's own op paths
    still mean what they meant. An array op on the shared array would have been in
    the same patch set from the start and forced at creation time.
  - **`truncate`'s cost is invisible to assertions.** Dropping the user's own patch
    leaves a perfectly valid group, so no invariant fires; the loss shows up only in
    the trace, and in production only to a user who notices their edit is missing.
    That asymmetry is itself the argument for `extend`.

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

`PatchSync.currentParentRef()` computes the parent of a new write from what the
server has said exists (`packages/ui/spa/stores/PatchSync.ts`); the server keeps ONE
linear chain and checks the `parentRef` of every write. If the server filtered the
response down to one group, every client would compute a parent that is not the real
chain head, and `PUT /patches` would answer 409 `patch-head-conflict` forever. Any
filtering variant would have to add an explicit chain-head field and rework
`currentParentRef` — real work, for no benefit.

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
   No client reads them yet. Every patch auto-joins **its own author's** current
   group (§2.2), and the migration backfills each open group with that author's own
   pending patches, so groups are populated before any client depends on them.
2. This repo, behind a flag: parse the annotations, keep applying _all_ patches, and
   send the group's ids to `/save`. This is the step where Publish stops being
   "everything pending" — a publisher ships their own work plus whatever the closure
   pulled in — so it is the risky step, and it is the one to watch after deploy.

   The backfill cannot compute the closure: patch sets come from the content schema,
   which lives in the app, not in the database. It writes each author's own patches
   as `explicit` members and leaves prefix holes to `repairGroup` under the `extend`
   policy, which the client runs on every recomputation of the index.

3. This repo: unstage becomes possible. Only now can a group be a strict subset, and
   only now does `apply_patches` need the group id.
4. UI in the compare view.

---

## 7. Testing rig

You asked for a rig that verifies the closure computation and catches issues. The
thing worth testing is **not** "does the closure function return this array" — it is
"does a staged subset actually apply, and does it produce what the compare view
promised". So the rig should _execute_ patches, not just compare metadata.

Location: `packages/ui/spa/utils/patchGroups.test.ts`, with the harness in
`patchGroupScenario.ts` next to it. Schemas are built with `s` from `initVal` and
patch streams are literal, following `PatchSets.test.ts` and the repo's test rules.

Two things make it reviewable rather than just green:

- every scenario emits a **readable trace** — chain, patch sets, each author's
  group and _why_ each pulled-in patch was pulled in, each author's view, and then
  the result of publishing each author's group in turn — asserted as a snapshot so
  the model can be reviewed by reading;
- every scenario also asserts **`problems` is empty**, so a real regression fails
  an assertion and does not merely change a snapshot.

The decisive design choice is that a scenario asserts on **content, not on patch
ids**. Each patch carries its author's intent as a predicate over that author's own
view (`holds`), which must still be true after anybody publishes. A `replace` that
lands on a different array element after someone else's commit is exactly what that
catches, and it is not detectable from group membership.

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

- **Staged is the truth** — the studio, the preview and Publish all show
  `base + your group`; only the compare view shows more. §2.
- **A group holds its owner's patches, closed over their patch sets.** Not a
  preference: §2.2 has the executable counterexample that rules out an empty group, and
  the argument for why the closure — rather than a blanket over everything pending — is
  what that counterexample actually demands. Publish therefore ships your own work plus
  what is entangled with it, which is a real change from Publish today.
- **Independence comes from the closure and from unstaging**, and a region you
  _deliberately_ held back is read-only until you stage it again; a region you simply
  never had is auto-staged before your op is resolved. §2.3, guarded by
  `editWouldRestage` and covered by the suite.
- **Patches outlive commits.** Alice publishes, Bob keeps working, and Bob's pending
  patches still apply on the new base. No `base_commit`, no rebase step. The
  "publish then continue" scenarios cover it.
- **Naming: patch group.** §2.5.
- **Repair policy: `extend`.** §4.1. The suite runs the same scenario under both;
  `truncate` drops the user's own work while leaving a perfectly valid group, so its
  cost is invisible to assertions and visible only to a user who notices their edit
  never went live.
- **`markApplied` gets implemented** — published patches must be reported `applied` so
  nobody re-applies them and so they leave the other groups.

### Still open

1. **Array co-editing entangles both authors.** Once two authors have both edited the
   same array and the first returns to it, both groups contain both authors' work and
   neither can publish alone. Arrays are therefore effectively single-writer for
   independent publishing. Either accept that, or make patch sets finer than "the whole
   array" — which `PatchSets` explicitly declined to do ("would need a lot of logic").
   Nothing is broken either way; it is a question of how much independence arrays get.
2. **Publishing someone else's patch.** The closure still pulls other authors' patches
   in whenever they share a patch set, so a publish can carry work that is not yours.
   Should they be warned, or the other authors told? At minimum a published patch must
   leave every group rather than silently vanishing.
3. **Empty publish.** A group can be emptied by unstaging. Publish should refuse with a
   clear message rather than committing nothing.
4. **`PatchSets.insert` takes one op at a time.** It is called per op, and
   `insertedPatches.add` sits before the `file`/`test` early return, so a patch whose
   _first_ op is a `file` op marks itself inserted and has its source ops dropped on
   every later call. It does not bite today only because `createFilePatch` and
   `ModuleGallery` both emit the source op first. The fix is to make `insert` take a
   whole patch, which changes its signature and four call sites — worth doing, but as
   its own change.
5. **Multiple groups per user.** The schema allows it; the UI does not. Confirm that
   "one open group per user per branch" is the v1 constraint, since it decides whether
   the group id needs to appear in URLs.

## 10. What is built, and what is left

Built on this branch, each as its own commit:

- [x] **Closure and guard** — `utils/patchGroups.ts`: `stageClosure`,
      `unstageClosure`, `validateGroup`, `repairGroup`, `heldPatchSets`,
      `holdsRegionOf`, `editWouldRestage`, `CLOSURE_VERSION`.
- [x] **Segment-aware patch set paths** in `PatchSets.insertPath` (§1, bug 1).
- [x] **Scenario suite** — `patchGroupScenario.ts` plus `patchGroups.test.ts`: a step
      script (edit / stage / unstage / publish) with op paths resolved against each
      author's own view, a readable trace per scenario, and hard assertions on
      invariants, applicability, author intent and refusals.
- [x] **Unit tests** — `patchGroupsStaging.test.ts`, one per primitive.
- [x] **API surface** — patch group fields on `/patches`, `patchGroupsSha` on `/stat`,
      and `/patch-groups/~/patches`; `ValOpsHttp` forwarding; FS mode acknowledging.
- [x] **UI** — `PatchStagingProvider`, `StagingToggle`, `HeldSummary`, wired into
      `ComparePatchSets`, with four Storybook stories.

- [x] **Server side (content.val.build)** — `valbuild/home`, branch
      `feat/independent-publish`: `val_patch_groups` / `val_patch_group_patches`,
      the group fields on `POST /patches` (with the fan-out to every other open
      group), additive `patchGroupIds` / `patchGroups` on `applicable/patches`,
      `GET /patch-groups` and `POST`/`DELETE /patch-groups/:id/patches`, commit
      bookkeeping, and `alsoUnstagePatchIds` on `DELETE /patches`. Behaviour-neutral:
      nothing reads it yet.

Left. Nothing is blocked any more — the server side exists; this is the client
wiring that turns it on.

**The wiring target moved.** `ValSyncEngine` was deleted in `22047f2c9` ("the store
system is the Studio"), so each item below names the store that now owns the job.
See `packages/ui/spa/stores/architecture.md`.

- [ ] **Hold the group** — group state in the store system, read from the
      `patchGroups` annotation on `applicable/patches`, and `patchGroupsSha` through
      `StatStore` so a stage/unstage in one tab reaches another. Patch ids alone
      cannot detect it: the pending set is unchanged, only who holds them.
- [ ] **Send the closure on write** — `PatchSync` adds `patchGroupId` and
      `alsoAddPatchIds` to `PUT /patches`. `stageClosure` already computes them;
      nothing calls it on the write path yet. (`holdBackForGroupIds` is still accepted
      by the endpoint but is inert now that a patch only ever joins its own author's
      group — there is no fan-out for it to suppress.)
- [x] **Group-scoped source** — `SourceStore.setVisiblePatchIds` rebuilds each module
      as base + the visible chain, so studio and preview show `base + your group`. Held
      patches stay in `chains` — held is not gone, and re-staging must not need a
      re-fetch. `null` is unscoped and keeps the pre-group behaviour; `[]` is a real,
      different answer. Covered by `stores/patchGroupPublish.test.ts`.
- [ ] **Enforce the guard at the point of editing** — `editWouldRestage` on the write
      path (`useAddPatch` / `writePath`), so a held region is genuinely read-only
      instead of a rule the tests know and the app does not.
- [x] **Publish the group, not everything** — `createSystem.publish` filters the
      chain by the group, preserving CHAIN order rather than the order the group names.
      This deliberately weakens "publish the whole pending chain": that was the
      conservative approximation of "do not leave behind a patch whose paths this could
      move", and the precise version is the patch-set prefix invariant the group already
      satisfies. Still to do: pass `patchGroupId` to `POST /commit` for bookkeeping.

- [x] **One setter for both** — `System.setPatchGroup` scopes source and publish in the
      same call, so "what I can see" and "what I will publish" cannot come apart.
      Publishing something the editor was never shown is the failure this feature exists
      to prevent, and two setters is how it would happen.
- [ ] **Feed the real group into `PatchStagingProvider`** where the compare view is
      mounted, replacing the local state the Storybook stories use.
- [x] **`patch_id` on `PUT /sources/~`** — the server applies exactly the patches it is
      told to, and everything only when told nothing. Covered by
      `packages/server/src/sourcesPatchGroup.test.ts`.

- [ ] **The RSC caller does not yet name its group.** `fetchVal` / `useVal` in draft mode
      do NOT go through the client stores — `initValRsc` calls `PUT /sources/~` and the
      server replays patches — so the client-side scoping above does not reach that path.
      The mechanism is now there; what is missing is resolving which group the session's
      user owns, which needs a lookup against the content API and a decision about paying
      for it per render. Until then a draft render shows base + everything pending, and a
      server-rendered preview and the Studio disagree about what is pending. Safe —
      nothing publishes from that path — but visible.
- [ ] **Auto-save** — fs-only today (`ValProvider.tsx` guards on `mode !== "fs"`),
      and fs has no groups, so it is correct as it stands. If groups ever reach fs
      mode, auto-save must send the group's ids: what it saves has to be exactly what
      a manual save would apply for that user.
- [ ] More scenarios: a `file` op patch whose source op is staged, a patch with no
      schema (whole-module fallback), nested arrays, unions, two modules in one group,
      a patch set that _un_-merges when the broad patch is the one committed.
- [ ] The seeded generative layer from §7.3.

CI, from `.agent/rules.md`: `pnpm run lint`, `pnpm -w run format`,
`pnpm run -r typecheck`, `pnpm test`, `pnpm run build`, and
`cd examples/next && pnpm run build`.
