# Independent publish — how it works

One editor publishes their own changes while other people's unpublished work
sits in the same patch chain, untouched.

## Two different things

- **Patch set** — computed from the schema. Patches that can shift each other's
  paths (an array insert moves every later index). Not curated; it is a fact
  about the content.
- **Patch group** — curated, one open group per author per branch. The set of
  patch ids that author intends to publish. This is what a publish ships.

## The chain

There is one linear, ordered, shared chain of patches on a branch. Publishing a
subset of it is only safe because of:

**The prefix invariant.** For every patch group and every patch set, the group's
members within that patch set form a _prefix_ of that set in chain order.

A patch left behind is then in a different patch set, so committing this group
cannot shift its paths. Skip a patch and ship a later one from the same set and
the later one applies onto a value that never existed.

The union of prefix-closed groups is prefix-closed, so two authors publishing
independently stay safe.

## Write path (atomic)

`POST /patches` carries the patch _and_ its membership in one request:

- No `patchGroupId` is sent. The server resolves "this author's open group on
  this branch, creating it if absent". The client must not hold an id across
  publishes — a publish closes the group and a write into a closed one is
  refused.
- `alsoAddPatchIds` is the **closure**: other patches that must join the group
  for the prefix invariant to hold. Computed on the client, which is the only
  side with the schema. The server set-unions it and does not second-guess it.
- Every refusal runs before the insert, so an invalid closure is a 400 with
  nothing written. A patch outside its author's group is one they cannot
  publish.
- The response returns `patchGroupId`. This is the only way the client learns
  the id of the group its own first write created.

## Read path (scoping)

- **Studio.** `System.setPatchGroup(ids)` sets _what is visible_ and _what will
  publish_ in one call. `SourceStore` holds back non-members (rebuild, not
  un-apply: JSON patches are not invertible). Held patches stay in the chain —
  held is not gone. `publish` filters the chain by the group, preserving _chain_
  order.
- **RSC / draft (`fetchVal`, `useVal`).** No client state, so it cannot name its
  own ids: `PUT /sources/~` with `own_patch_groups_only`, and the server
  resolves the caller's open groups from the session.

Three states are kept distinct at every hop, and collapsing any two is a bug
with a different symptom each time:

| value         | meaning                      | behaviour                 |
| ------------- | ---------------------------- | ------------------------- |
| `null`/absent | no groups on this deployment | unscoped (today's)        |
| `[]`          | a group holding nothing      | render base, ship nothing |
| `[...]`       | a group                      | scoped                    |

A failed group lookup renders **base**, not everything: a degraded preview beats
leaking someone's draft.

## Keeping the invariant

- **Writes** carry their closure (above), so a group cannot gain a hole from
  anything its owner does.
- **Coalescing** can still open one: `PatchSets.insertPath` merges an existing
  set into a broader one, so a third party's insert can swallow two leaf sets
  and leave a hole in a group whose owner touched nothing.
  `repairGroup(index, group, "extend")` runs on _every_ recomputation of the
  patch-set index — from the shell, not only the review screen, because the
  insert arrives while the owner is editing elsewhere.
- **Publish** re-checks and _refuses_ a group with holes, naming them. It does
  not repair: extending at publish time would ship work the user never staged.

## Publish

Commits the group's patches in chain order; the content API closes the group
(`publishedAt`). Patches stay in the chain marked `applied` until the new commit
comes back. The next write creates the next group, so the client forgets the id
on publish.

## Invariants worth attacking in review

1. Is the prefix invariant actually sufficient, or can two patches in _different_
   patch sets still interact? (Patch sets are defined as "can shift each other's
   paths"; the safety argument rests entirely on that definition being complete.)
2. The closure is computed client-side and trusted server-side. A buggy or old
   client can write an under-closed group. `closureVersion` is stored per
   membership row so such rows are identifiable and recomputable — but nothing
   currently recomputes them.
3. Repair policy is `extend`, which silently grows a group to include another
   author's patch. `truncate` would silently drop the user's own work instead.
   Neither is obviously right.
4. Scope is client-held local truth seeded from the server's annotation and
   corrected by the next fetch. A failed stage is corrected rather than kept —
   but there is a window where the screen and the server disagree.
5. Held patches count as _settled_ but not _applied_ (`chainSettled`), because
   the editor holds every field inert until the chain settles. A held patch that
   counted as neither would dim the Studio permanently.
